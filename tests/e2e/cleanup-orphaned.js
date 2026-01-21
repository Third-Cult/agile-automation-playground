#!/usr/bin/env node

/**
 * Cleanup Orphaned E2E Test Resources
 * 
 * This script helps clean up PRs and branches that weren't cleaned up
 * after test failures or interruptions.
 */

require('dotenv').config();
const { Octokit } = require('@octokit/rest');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const E2E_TEST_PREFIX = process.env.E2E_TEST_PREFIX || 'e2e-test';

if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
  console.error('❌ Missing required environment variables:');
  console.error('   GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function cleanupOrphanedPRs() {
  console.log(`\n🔍 Searching for orphaned E2E test PRs in ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}...\n`);

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
      console.log('✅ No orphaned test PRs found.');
      return;
    }

    console.log(`Found ${testPRs.length} test PR(s):\n`);

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

        // Delete the branch
        try {
          await octokit.git.deleteRef({
            owner: GITHUB_REPO_OWNER,
            repo: GITHUB_REPO_NAME,
            ref: `heads/${pr.head.ref}`,
          });
          console.log(`    ✓ Deleted branch ${pr.head.ref}`);
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

    console.log('✅ Cleanup complete!\n');
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

// Run cleanup
cleanupOrphanedPRs();
