#!/usr/bin/env node

/**
 * Manual E2E Test Cleanup
 * 
 * This script cleans up all E2E test resources (GitHub PRs, branches, and Discord messages/threads).
 * 
 * Usage:
 *   npm run test:e2e:cleanup
 * 
 * This will:
 * - Find and close all test PRs
 * - Delete all test branches
 * - Find and delete all test Discord messages and threads (if bot has permissions)
 */

require('dotenv').config();
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID, 10) : undefined;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY;
const GITHUB_APP_INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID ? parseInt(process.env.GITHUB_APP_INSTALLATION_ID, 10) : undefined;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const E2E_TEST_PREFIX = process.env.E2E_TEST_PREFIX || 'e2e-test';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID || process.env.DISCORD_PR_CHANNEL_ID;

if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
  console.error('❌ Missing required environment variables:');
  console.error('   GITHUB_REPO_OWNER, GITHUB_REPO_NAME');
  process.exit(1);
}

// Check authentication method
const hasPAT = !!GITHUB_TOKEN;
const hasApp = !!(GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY);

if (!hasPAT && !hasApp) {
  console.error('❌ Missing authentication:');
  console.error('   Either GITHUB_TOKEN or GitHub App configuration (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY) is required.');
  process.exit(1);
}

// Process private key if base64 encoded
let processedPrivateKey = GITHUB_APP_PRIVATE_KEY;
if (GITHUB_APP_PRIVATE_KEY && !GITHUB_APP_PRIVATE_KEY.includes('-----BEGIN')) {
  try {
    processedPrivateKey = Buffer.from(GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf-8');
  } catch (error) {
    console.warn('⚠️  Failed to decode base64 private key, using as-is');
  }
}

let octokit;
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Make a Discord API request
 */
async function discordRequest(endpoint, options = {}) {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN not configured');
  }
  
  const url = `${DISCORD_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok && response.status !== 204) {
    const errorText = await response.text();
    throw new Error(`Discord API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text || text.trim() === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Get Discord messages from channel
 */
async function getDiscordMessages(limit = 50) {
  if (!DISCORD_CHANNEL_ID) {
    return [];
  }
  
  try {
    return await discordRequest(`/channels/${DISCORD_CHANNEL_ID}/messages?limit=${limit}`);
  } catch (error) {
    console.warn(`⚠️  Failed to fetch Discord messages: ${error.message}`);
    return [];
  }
}

/**
 * Delete Discord message
 */
async function deleteDiscordMessage(messageId) {
  if (!DISCORD_CHANNEL_ID) {
    return false;
  }
  
  try {
    await discordRequest(`/channels/${DISCORD_CHANNEL_ID}/messages/${messageId}`, {
      method: 'DELETE',
    });
    return true;
  } catch (error) {
    if (error.message.includes('404') || error.message.includes('403')) {
      return false; // Already deleted or no permission
    }
    throw error;
  }
}

/**
 * Delete Discord thread
 */
async function deleteDiscordThread(threadId) {
  try {
    await discordRequest(`/channels/${threadId}`, {
      method: 'DELETE',
    });
    return true;
  } catch (error) {
    if (error.message.includes('404') || error.message.includes('403')) {
      return false; // Already deleted or no permission
    }
    throw error;
  }
}

/**
 * Auto-discover installation ID for a repository
 */
async function getInstallationId(appAuth, owner, repo) {
  try {
    const appAuthentication = await appAuth({ type: 'app' });
    const tempOctokit = new Octokit({ auth: appAuthentication.token });
    const { data } = await tempOctokit.apps.getRepoInstallation({ owner, repo });
    return data.id;
  } catch (error) {
    if (error.status === 404) {
      throw new Error(
        `GitHub App is not installed on ${owner}/${repo}. ` +
        `Please install the app on the repository or provide GITHUB_APP_INSTALLATION_ID.`
      );
    }
    throw new Error(`Failed to discover installation ID for ${owner}/${repo}: ${error.message}`);
  }
}

/**
 * Initialize Octokit with authentication
 */
async function initializeOctokit() {
  if (hasApp) {
    try {
      const appAuth = createAppAuth({
        appId: GITHUB_APP_ID,
        privateKey: processedPrivateKey,
      });

      let installationId = GITHUB_APP_INSTALLATION_ID;
      if (!installationId) {
        console.log(`🔍 Auto-discovering installation ID for ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}...`);
        installationId = await getInstallationId(appAuth, GITHUB_REPO_OWNER, GITHUB_REPO_NAME);
        console.log(`✓ Found installation ID: ${installationId}`);
      }

      const installationAuth = await appAuth({
        type: 'installation',
        installationId,
      });

      return new Octokit({ auth: installationAuth.token });
    } catch (error) {
      console.error('❌ Failed to authenticate with GitHub App:', error.message);
      if (hasPAT) {
        console.log('⚠️  Falling back to PAT authentication...');
        return new Octokit({ auth: GITHUB_TOKEN });
      }
      throw error;
    }
  } else {
    return new Octokit({ auth: GITHUB_TOKEN });
  }
}

/**
 * Cleanup GitHub PRs and branches
 */
async function cleanupGitHub() {
  console.log(`\n🔍 Searching for E2E test PRs in ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}...\n`);
  
  // Initialize Octokit
  octokit = await initializeOctokit();

  try {
    // Get all open PRs
    const { data: prs } = await octokit.pulls.list({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      state: 'open',
      per_page: 100,
    });

    // Filter PRs that match our test prefix
    const testPRs = prs.filter((pr) => 
      pr.title.includes('[E2E]') || 
      pr.head.ref.startsWith(E2E_TEST_PREFIX)
    );

    if (testPRs.length === 0) {
      console.log('✅ No test PRs found.');
      return { prsCleaned: 0, branchesCleaned: 0 };
    }

    console.log(`Found ${testPRs.length} test PR(s):\n`);

    let prsCleaned = 0;
    let branchesCleaned = 0;

    for (const pr of testPRs) {
      console.log(`  PR #${pr.number}: ${pr.title}`);
      console.log(`    Branch: ${pr.head.ref}`);
      console.log(`    URL: ${pr.html_url}`);
      
      try {
        // Close the PR
        await octokit.pulls.update({
          owner: GITHUB_REPO_OWNER,
          repo: GITHUB_REPO_NAME,
          pull_number: pr.number,
          state: 'closed',
        });
        console.log(`    ✓ Closed PR #${pr.number}`);
        prsCleaned++;

        // Delete the branch
        try {
          await octokit.git.deleteRef({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            ref: `heads/${pr.head.ref}`,
          });
          console.log(`    ✓ Deleted branch ${pr.head.ref}`);
          branchesCleaned++;
        } catch (error) {
          if (error.status === 422 || error.status === 404) {
            console.log(`    ⚠️  Branch ${pr.head.ref} already deleted or is default branch`);
          } else {
            throw error;
          }
        }
      } catch (error) {
        console.error(`    ❌ Error cleaning up PR #${pr.number}:`, error.message);
      }
      console.log('');
    }

    return { prsCleaned, branchesCleaned };
  } catch (error) {
    console.error('❌ Error during GitHub cleanup:', error.message);
    throw error;
  }
}

/**
 * Cleanup Discord messages and threads
 */
async function cleanupDiscord() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
    console.log('\n⚠️  Discord credentials not configured. Skipping Discord cleanup.');
    return { messagesCleaned: 0, threadsCleaned: 0 };
  }

  console.log(`\n🔍 Searching for E2E test messages in Discord channel...\n`);

  try {
    const messages = await getDiscordMessages(100);
    
    // Filter messages that contain PR numbers (test messages typically have "PR #" in them)
    // We'll look for messages that might be test messages
    const testMessages = messages.filter((msg) => {
      const content = msg.content || '';
      // Look for PR number pattern or E2E test indicators
      return /PR #\d+/.test(content) || content.includes('[E2E]');
    });

    if (testMessages.length === 0) {
      console.log('✅ No test Discord messages found.');
      return { messagesCleaned: 0, threadsCleaned: 0 };
    }

    console.log(`Found ${testMessages.length} potential test message(s):\n`);

    let messagesCleaned = 0;
    let threadsCleaned = 0;

    for (const message of testMessages) {
      console.log(`  Message ${message.id}`);
      console.log(`    Content: ${(message.content || '').substring(0, 100)}...`);
      
      try {
        // Delete thread first if it exists
        if (message.thread && message.thread.id) {
          try {
            await deleteDiscordThread(message.thread.id);
            console.log(`    ✓ Deleted thread ${message.thread.id}`);
            threadsCleaned++;
          } catch (error) {
            console.warn(`    ⚠️  Failed to delete thread ${message.thread.id}: ${error.message}`);
          }
        }

        // Delete the message
        try {
          const deleted = await deleteDiscordMessage(message.id);
          if (deleted) {
            console.log(`    ✓ Deleted message ${message.id}`);
            messagesCleaned++;
          } else {
            console.log(`    ⚠️  Message ${message.id} already deleted or no permission`);
          }
        } catch (error) {
          console.warn(`    ⚠️  Failed to delete message ${message.id}: ${error.message}`);
        }
      } catch (error) {
        console.error(`    ❌ Error cleaning up message ${message.id}:`, error.message);
      }
      console.log('');
    }

    return { messagesCleaned, threadsCleaned };
  } catch (error) {
    console.error('❌ Error during Discord cleanup:', error.message);
    // Don't throw - Discord cleanup is optional
    return { messagesCleaned: 0, threadsCleaned: 0 };
  }
}

/**
 * Main cleanup function
 */
async function main() {
  console.log('🧹 Manual E2E Test Cleanup\n');
  console.log('This will clean up:');
  console.log('  - GitHub PRs and branches');
  console.log('  - Discord messages and threads (if configured)\n');
  
  if (hasApp) {
    console.log(`Using GitHub App authentication (App ID: ${GITHUB_APP_ID})\n`);
  } else {
    console.log('Using PAT authentication\n');
  }

  try {
    // Cleanup GitHub
    const githubResult = await cleanupGitHub();
    
    // Cleanup Discord
    const discordResult = await cleanupDiscord();

    // Summary
    console.log('\n📊 Cleanup Summary:');
    console.log(`  GitHub: ${githubResult.prsCleaned} PR(s) closed, ${githubResult.branchesCleaned} branch(es) deleted`);
    console.log(`  Discord: ${discordResult.messagesCleaned} message(s) deleted, ${discordResult.threadsCleaned} thread(s) deleted`);
    console.log('\n✅ Cleanup complete!\n');
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

// Run cleanup
main();
