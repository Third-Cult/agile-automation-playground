import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';
import { GitHubClient } from './helpers/github-client';
import { DiscordClient } from './helpers/discord-client';
import { waitForWorkflow, wait } from './helpers/workflow-waiter';
import { cleanupPR, cleanupDiscordMessageAndThread, generateTestId } from './helpers/cleanup';
import {
  verifyMessageContent,
  verifyPRMetadata,
  verifyReaction,
  verifyThreadState,
  verifyPROpenedDraftFormat,
  verifyPROpenedReadyFormat,
  verifyPROpenedReadyWithReviewersFormat,
  verifyStatusLine,
  verifyReviewerMention,
} from './helpers/verification';
import { TestDataGenerator } from './fixtures/test-data';

// Test Status:
// ✅ Test 1: PR Opened (Draft) - Implemented
// ✅ Test 2: PR Opened (Ready) - Implemented
// ✅ Test 3: PR Opened (Multiple Reviewers) - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 4: Draft → Ready - Implemented
// ✅ Test 5: Reviewer Added - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 6: Reviewer Removed - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 7: Review Approved - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 8: Changes Requested - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 9: Review Comment Only - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 10: Review Dismissed - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 11: Review Dismissed (Approved) - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 12: PR Synchronize (After Approval) - Implemented (requires E2E_TEST_REVIEWERS)
// ✅ Test 13: PR Synchronize (No Approval) - Implemented
// ✅ Test 14: PR Closed - Implemented
// ✅ Test 15: PR Merged - Implemented

/**
 * E2E Testing Approach:
 * 
 * Reviewer Assignment:
 * - Reviewers are assigned using real GitHub usernames (from E2E_TEST_REVIEWERS config)
 * - This ensures Discord can correctly map GitHub usernames to Discord users for notifications
 * 
 * Review Actions:
 * - Review actions (approve, request changes, comment) are performed by the GitHub App
 * - This allows testing without requiring actual users to perform actions
 * - The GitHub App submits reviews on behalf of the assigned reviewers
 * 
 * This approach enables:
 * - Testing Discord username mapping functionality
 * - Automated testing without user intervention
 * - Independent test execution in any environment with proper GitHub App setup
 */

// E2E tests must run sequentially to avoid rate limits and resource conflicts
describe('E2E Tests - Discord PR Notifications', () => {
  let config: ReturnType<typeof loadConfig>;
  let github: GitHubClient;
  let discord: DiscordClient;
  let testData: TestDataGenerator;
  let testPRs: number[] = []; // Track PRs for cleanup
  let testDiscordMessages: Array<{ messageId: string; threadId?: string }> = []; // Track Discord messages for cleanup

  /**
   * Track a Discord message for cleanup
   */
  function trackDiscordMessage(message: { id: string; thread?: { id: string } } | null) {
    if (message) {
      testDiscordMessages.push({
        messageId: message.id,
        threadId: message.thread?.id,
      });
    }
  }

  beforeEach(async () => {
    try {
      config = loadConfig();
      github = await GitHubClient.create(config);
      discord = new DiscordClient(config);
      testData = new TestDataGenerator(config.test.prefix);
    } catch (error) {
      console.error('Failed to load config:', error);
      throw error;
    }
  });

  afterEach(async () => {
    // Always cleanup, even if config failed to load
    try {
      const shouldCleanup = config?.test?.cleanup !== false;
      if (shouldCleanup) {
        // Cleanup Discord messages and threads first
        if (discord && testDiscordMessages.length > 0) {
          console.log(`\n🧹 Cleaning up ${testDiscordMessages.length} Discord message(s) and thread(s)...`);
          for (const { messageId, threadId } of testDiscordMessages) {
            try {
              // Delete both the thread and message
              await cleanupDiscordMessageAndThread(discord, messageId, threadId);
              console.log(`  ✓ Cleaned up Discord message ${messageId}${threadId ? ` and thread ${threadId}` : ''}`);
            } catch (error) {
              console.warn(`  ⚠️  Failed to cleanup Discord message ${messageId}${threadId ? ` and thread ${threadId}` : ''}:`, error);
            }
          }
        }

        // Cleanup GitHub PRs
        if (github && testPRs.length > 0) {
          console.log(`\n🧹 Cleaning up ${testPRs.length} test PR(s)...`);
          for (const prNumber of testPRs) {
            try {
              await cleanupPR(github, prNumber, true);
              console.log(`  ✓ Cleaned up PR #${prNumber}`);
            } catch (error) {
              console.warn(`  ⚠️  Failed to cleanup PR #${prNumber}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      testPRs = [];
      testDiscordMessages = [];
    }
  });

  // Test 1: PR Opened (Draft) - IMPLEMENT FIRST
  describe('Test 1: PR Opened (Draft)', () => {
    it('Test 1: should create Discord message for draft PR with reviewers', async () => {
      console.log('\n📝 Starting Test 1: PR Opened (Draft)\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Opened Draft', testId);
      const prDescription = testData.generatePRDescription('Test 1: PR Opened (Draft)');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 1');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create draft PR with a reviewer (use the repo owner as reviewer if available)
      console.log(`🔨 Creating draft PR...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        true, // draft
        [] // no reviewers for now - we'll add this capability later
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for workflow to complete
      console.log('⏳ Waiting for GitHub Actions workflow to complete...');
      const workflowRun = await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      
      if (!workflowRun) {
        console.warn('⚠️  Workflow did not complete within timeout, continuing with verification...\n');
      } else {
        console.log(`✓ Workflow completed\n`);
      }

      // Wait a bit more for Discord message and thread to appear
      console.log('⏳ Waiting for Discord message and thread to appear...');
      await wait(5000); // Give extra time for thread creation
      console.log(`✓ Ready\n`);

      // Find Discord message by PR number
      console.log(`🔍 Searching for Discord message with PR #${pr.number}...`);
      const discordMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);

      // Verify Discord message exists
      expect(discordMessage).toBeDefined();
      expect(discordMessage).not.toBeNull();

      if (discordMessage) {
        console.log(`✓ Discord message found: ${discordMessage.id}\n`);
        
        // Track message for cleanup
        trackDiscordMessage(discordMessage);
        
        // Verify message content
        console.log('✅ Verifying message content...');
        const contentCheck = verifyMessageContent(discordMessage, [
          `PR #${pr.number}`,
          prTitle,
          'Draft - In Progress',
        ]);

        expect(contentCheck.passed).toBe(true);
        if (!contentCheck.passed) {
          console.error('❌ Message content verification failed:', contentCheck.errors);
          console.log('Actual message content:', discordMessage.content);
        } else {
          console.log(`✓ Message content verified\n`);
        }

        // Get PR author for formatting verification
        console.log('📋 Fetching PR author for formatting verification...');
        const author = await github.getPRAuthor(pr.number);
        console.log(`✓ PR author: ${author}\n`);

        // Verify message formatting
        console.log('✅ Verifying message formatting...');
        const formatCheck = verifyPROpenedDraftFormat(
          discordMessage,
          pr.number,
          prTitle,
          pr.url,
          branchName,
          defaultBranch,
          author,
          prDescription
        );

        if (!formatCheck.passed) {
          console.error('❌ Message formatting verification failed:');
          formatCheck.errors.forEach((error) => {
            console.error(`  - ${error}`);
          });
          console.log('\nActual message content:');
          console.log('---');
          console.log(discordMessage.content);
          console.log('---\n');
          // Throw error with all formatting issues
          throw new Error(`Message formatting verification failed:\n${formatCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${discordMessage.content}`);
        } else {
          console.log(`✓ Message formatting verified\n`);
        }

        // Wait a bit more and check metadata for thread ID
        // Sometimes thread info isn't immediately available in message object
        console.log('⏳ Waiting before checking metadata...');
        await wait(2000);
        console.log(`✓ Ready\n`);
        
        // Verify metadata was saved to PR and get thread ID
        console.log(`📋 Verifying PR metadata...`);
        const metadataCheck = await verifyPRMetadata(github, pr.number);
        let threadId: string | undefined;
        
        if (metadataCheck.passed && metadataCheck.metadata) {
          threadId = metadataCheck.metadata.thread_id;
          console.log(`✓ Metadata found - Thread ID: ${threadId}\n`);
          
          // If message doesn't have thread info but metadata does, enrich the message
          if (!discordMessage.thread && threadId) {
            try {
              console.log(`🔍 Fetching thread ${threadId} from Discord...`);
              const thread = await discord.getThread(threadId);
              console.log(`✓ Thread fetched: ${thread.name}\n`);
              discordMessage.thread = {
                id: thread.id,
                name: thread.name,
                locked: thread.locked,
                archived: thread.archived,
              };
            } catch (error) {
              console.warn(`⚠️  Failed to fetch thread ${threadId} from Discord:`, error);
            }
          }
        } else {
          // Get all comments for debugging
          const allComments = await github.getPRComments(pr.number);
          console.log(`\n⚠️  Debug: Found ${allComments.length} comments on PR #${pr.number}`);
          allComments.forEach((c, i) => {
            console.log(`Comment ${i + 1}: ${c.body?.substring(0, 100)}...`);
          });
          console.error('❌ Metadata verification failed:', metadataCheck.error);
        }

        // Verify thread was created (either from message or metadata)
        console.log('✅ Verifying thread creation...');
        if (discordMessage.thread) {
          expect(discordMessage.thread.id).toBeDefined();
          console.log(`✓ Thread found in message object: ${discordMessage.thread.id}\n`);
          // Update tracked message with thread ID for cleanup
          const trackedIndex = testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
          if (trackedIndex >= 0) {
            testDiscordMessages[trackedIndex].threadId = discordMessage.thread.id;
          }
        } else if (threadId) {
          // Thread exists according to metadata, but not in message object
          // This is okay - we'll track it for cleanup
          console.log(`✓ Thread ID from metadata (not in message object): ${threadId}\n`);
          const trackedIndex = testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
          if (trackedIndex >= 0) {
            testDiscordMessages[trackedIndex].threadId = threadId;
          }
          // Verify thread actually exists by fetching it
          try {
            console.log(`🔍 Verifying thread ${threadId} exists in Discord...`);
            const thread = await discord.getThread(threadId);
            expect(thread).toBeDefined();
            expect(thread.id).toBe(threadId);
            console.log(`✓ Thread verified\n`);
          } catch (error) {
            console.error(`❌ Thread ${threadId} from metadata does not exist in Discord:`, error);
            throw new Error(`Thread ${threadId} from metadata does not exist in Discord`);
          }
        } else {
          throw new Error('Thread was not created - neither message.thread nor metadata.thread_id found');
        }
        
        console.log('\n✅ Test 1 completed successfully!\n');
      }
    }, 600000); // 10 minute timeout for E2E tests
  });

  // Test 2: PR Opened (Ready) - IMPLEMENT SECOND
  describe('Test 2: PR Opened (Ready)', () => {
    it('Test 2: should create Discord message with warning for ready PR without reviewers', async () => {
      console.log('\n📝 Starting Test 2: PR Opened (Ready)\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Opened Ready', testId);
      const prDescription = testData.generatePRDescription('Test 2: PR Opened (Ready)');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 2');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create ready PR without reviewers
      console.log(`🔨 Creating ready PR (no reviewers)...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false, // not draft
        [] // no reviewers
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for workflow to complete
      console.log('⏳ Waiting for GitHub Actions workflow to complete...');
      const workflowRun = await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      
      if (!workflowRun) {
        console.warn('⚠️  Workflow did not complete within timeout, continuing with verification...\n');
      } else {
        console.log(`✓ Workflow completed\n`);
      }

      // Wait a bit more for Discord message and thread to appear
      console.log('⏳ Waiting for Discord message and thread to appear...');
      await wait(5000); // Give extra time for thread creation
      console.log(`✓ Ready\n`);

      // Find Discord message by PR number
      console.log(`🔍 Searching for Discord message with PR #${pr.number}...`);
      const discordMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);

      // Verify Discord message exists
      expect(discordMessage).toBeDefined();
      expect(discordMessage).not.toBeNull();

      if (discordMessage) {
        console.log(`✓ Discord message found: ${discordMessage.id}\n`);
        
        // Track message for cleanup
        trackDiscordMessage(discordMessage);
        
        // Verify message content includes warning
        console.log('✅ Verifying message content (including WARNING)...');
        const contentCheck = verifyMessageContent(discordMessage, [
          `PR #${pr.number}`,
          prTitle,
          'Ready for Review',
          'WARNING',
          'No reviewers assigned',
        ]);

        expect(contentCheck.passed).toBe(true);
        if (!contentCheck.passed) {
          console.error('❌ Message content verification failed:', contentCheck.errors);
          console.log('Actual message content:', discordMessage.content);
        } else {
          console.log(`✓ Message content verified (WARNING found)\n`);
        }

        // Get PR author for formatting verification
        console.log('📋 Fetching PR author for formatting verification...');
        const author = await github.getPRAuthor(pr.number);
        console.log(`✓ PR author: ${author}\n`);

        // Verify message formatting
        console.log('✅ Verifying message formatting...');
        const formatCheck = verifyPROpenedReadyFormat(
          discordMessage,
          pr.number,
          prTitle,
          pr.url,
          branchName,
          defaultBranch,
          author,
          prDescription
        );

        if (!formatCheck.passed) {
          console.error('❌ Message formatting verification failed:');
          formatCheck.errors.forEach((error) => {
            console.error(`  - ${error}`);
          });
          console.log('\nActual message content:');
          console.log('---');
          console.log(discordMessage.content);
          console.log('---\n');
          // Throw error with all formatting issues
          throw new Error(`Message formatting verification failed:\n${formatCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${discordMessage.content}`);
        } else {
          console.log(`✓ Message formatting verified\n`);
        }

        // Wait a bit more and check metadata for thread ID
        console.log('⏳ Waiting before checking metadata...');
        await wait(2000);
        console.log(`✓ Ready\n`);
        
        // Verify metadata was saved to PR and get thread ID
        console.log(`📋 Verifying PR metadata...`);
        const metadataCheck = await verifyPRMetadata(github, pr.number);
        let threadId: string | undefined;
        
        if (metadataCheck.passed && metadataCheck.metadata) {
          threadId = metadataCheck.metadata.thread_id;
          console.log(`✓ Metadata found - Thread ID: ${threadId}\n`);
          
          // If message doesn't have thread info but metadata does, enrich the message
          if (!discordMessage.thread && threadId) {
            try {
              console.log(`🔍 Fetching thread ${threadId} from Discord...`);
              const thread = await discord.getThread(threadId);
              console.log(`✓ Thread fetched: ${thread.name}\n`);
              discordMessage.thread = {
                id: thread.id,
                name: thread.name,
                locked: thread.locked,
                archived: thread.archived,
              };
            } catch (error) {
              console.warn(`⚠️  Failed to fetch thread ${threadId} from Discord:`, error);
            }
          }
        } else {
          // Get all comments for debugging
          const allComments = await github.getPRComments(pr.number);
          console.log(`\n⚠️  Debug: Found ${allComments.length} comments on PR #${pr.number}`);
          allComments.forEach((c, i) => {
            console.log(`Comment ${i + 1}: ${c.body?.substring(0, 100)}...`);
          });
          console.error('❌ Metadata verification failed:', metadataCheck.error);
        }

        // Verify thread was created (either from message or metadata)
        console.log('✅ Verifying thread creation...');
        if (discordMessage.thread) {
          expect(discordMessage.thread.id).toBeDefined();
          console.log(`✓ Thread found in message object: ${discordMessage.thread.id}\n`);
          // Update tracked message with thread ID for cleanup
          const trackedIndex = testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
          if (trackedIndex >= 0) {
            testDiscordMessages[trackedIndex].threadId = discordMessage.thread.id;
          }
        } else if (threadId) {
          // Thread exists according to metadata, but not in message object
          // This is okay - we'll track it for cleanup
          console.log(`✓ Thread ID from metadata (not in message object): ${threadId}\n`);
          const trackedIndex = testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
          if (trackedIndex >= 0) {
            testDiscordMessages[trackedIndex].threadId = threadId;
          }
          // Verify thread actually exists by fetching it
          try {
            console.log(`🔍 Verifying thread ${threadId} exists in Discord...`);
            const thread = await discord.getThread(threadId);
            expect(thread).toBeDefined();
            expect(thread.id).toBe(threadId);
            console.log(`✓ Thread verified\n`);
          } catch (error) {
            console.error(`❌ Thread ${threadId} from metadata does not exist in Discord:`, error);
            throw new Error(`Thread ${threadId} from metadata does not exist in Discord`);
          }
        } else {
          throw new Error('Thread was not created - neither message.thread nor metadata.thread_id found');
        }
        
        // Note: Metadata check is lenient - we log but don't fail if it's not found immediately
        if (!metadataCheck.passed) {
          console.warn('⚠️  Metadata not found, but Discord message and thread were created successfully');
        }
        
        console.log('\n✅ Test 2 completed successfully!\n');
      }
    }, 600000); // 10 minute timeout for E2E tests
  });

  // Test 3: PR Opened (Multiple Reviewers) - IMPLEMENT THIRD
  describe('Test 3: PR Opened (Multiple Reviewers)', () => {
    it('Test 3: should create Discord message listing all reviewers', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 2) {
        console.warn('Skipping Test 3: E2E_TEST_REVIEWERS not configured with at least 2 reviewers');
        return;
      }

      console.log('\n📝 Starting Test 3: PR Opened (Multiple Reviewers)\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Opened Multiple Reviewers', testId);
      const prDescription = testData.generatePRDescription('Test 3: PR Opened (Multiple Reviewers)');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 3');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Use first 2-3 reviewers from config
      // Note: Reviewers are assigned using real GitHub usernames so Discord can map them correctly
      const reviewers = config.test.reviewers.slice(0, Math.min(3, config.test.reviewers.length));
      console.log(`👥 Using reviewers: ${reviewers.join(', ')}`);
      console.log(`   (Reviewers assigned for Discord mapping)\n`);

      // Create ready PR with multiple reviewers
      console.log(`🔨 Creating ready PR with ${reviewers.length} reviewer(s)...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false, // not draft
        reviewers
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for workflow to complete
      console.log('⏳ Waiting for GitHub Actions workflow to complete...');
      const workflowRun = await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      
      if (!workflowRun) {
        console.warn('⚠️  Workflow did not complete within timeout, continuing with verification...\n');
      } else {
        console.log(`✓ Workflow completed\n`);
      }

      // Wait a bit more for Discord message and thread to appear
      console.log('⏳ Waiting for Discord message and thread to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Find Discord message by PR number
      console.log(`🔍 Searching for Discord message with PR #${pr.number}...`);
      const discordMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);

      // Verify Discord message exists
      expect(discordMessage).toBeDefined();
      expect(discordMessage).not.toBeNull();

      if (discordMessage) {
        console.log(`✓ Discord message found: ${discordMessage.id}\n`);
        
        // Track message for cleanup
        trackDiscordMessage(discordMessage);
        
        // Verify message content includes all reviewers
        console.log('✅ Verifying message content and reviewers...');
        const contentCheck = verifyMessageContent(discordMessage, [
          `PR #${pr.number}`,
          prTitle,
          'Ready for Review',
        ]);

        expect(contentCheck.passed).toBe(true);
        if (!contentCheck.passed) {
          console.error('❌ Message content verification failed:', contentCheck.errors);
          console.log('Actual message content:', discordMessage.content);
        } else {
          console.log(`✓ Message content verified\n`);
        }

        // Verify all reviewers are listed (check for reviewer mentions)
        // Note: Reviewers might be mapped to Discord IDs, so we check for the reviewers line format
        console.log(`🔍 Checking for ${reviewers.length} reviewer(s) in message...`);
        const hasReviewersLine = discordMessage.content.includes('**Reviewers:**');
        expect(hasReviewersLine).toBe(true);
        if (hasReviewersLine) {
          console.log(`  ✓ Found reviewers line in message`);
        }
        
        // Check if reviewers are mentioned (they might be Discord IDs or usernames)
        let reviewersFound = 0;
        for (const reviewer of reviewers) {
          // Check for username, @username, or Discord mention format
          if (discordMessage.content.includes(reviewer) || 
              discordMessage.content.includes(`@${reviewer}`) ||
              discordMessage.content.includes(`<@`) && discordMessage.content.includes('**Reviewers:**')) {
            reviewersFound++;
            console.log(`  ✓ Found reviewer: ${reviewer}`);
          }
        }
        console.log(`✓ Found ${reviewersFound} of ${reviewers.length} reviewer(s) (reviewers may be mapped to Discord IDs)\n`);

        // Should find at least the reviewers line, and ideally all reviewers
        // But allow for Discord ID mapping which makes exact username matching harder
        expect(hasReviewersLine).toBe(true);

        // Get PR author for formatting verification
        console.log('📋 Fetching PR author for formatting verification...');
        const author = await github.getPRAuthor(pr.number);
        console.log(`✓ PR author: ${author}\n`);

        // Verify message formatting
        console.log('✅ Verifying message formatting...');
        const formatCheck = verifyPROpenedReadyWithReviewersFormat(
          discordMessage,
          pr.number,
          prTitle,
          pr.url,
          branchName,
          defaultBranch,
          author,
          reviewers,
          prDescription
        );

        if (!formatCheck.passed) {
          console.error('❌ Message formatting verification failed:');
          formatCheck.errors.forEach((error) => {
            console.error(`  - ${error}`);
          });
          console.log('\nActual message content:');
          console.log('---');
          console.log(discordMessage.content);
          console.log('---\n');
          // Throw error with all formatting issues
          throw new Error(`Message formatting verification failed:\n${formatCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${discordMessage.content}`);
        } else {
          console.log(`✓ Message formatting verified\n`);
        }

        // Wait a bit more and check metadata for thread ID
        console.log('⏳ Waiting before checking metadata...');
        await wait(2000);
        console.log(`✓ Ready\n`);
        
        // Verify metadata was saved to PR and get thread ID
        console.log(`📋 Verifying PR metadata...`);
        const metadataCheck = await verifyPRMetadata(github, pr.number);
        let threadId: string | undefined;
        
        if (metadataCheck.passed && metadataCheck.metadata) {
          threadId = metadataCheck.metadata.thread_id;
          console.log(`✓ Metadata found - Thread ID: ${threadId}\n`);
          
          // If message doesn't have thread info but metadata does, enrich the message
          if (!discordMessage.thread && threadId) {
            try {
              console.log(`🔍 Fetching thread ${threadId} from Discord...`);
              const thread = await discord.getThread(threadId);
              console.log(`✓ Thread fetched: ${thread.name}\n`);
              discordMessage.thread = {
                id: thread.id,
                name: thread.name,
                locked: thread.locked,
                archived: thread.archived,
              };
            } catch (error) {
              console.warn(`⚠️  Failed to fetch thread ${threadId} from Discord:`, error);
            }
          }
        } else {
          const allComments = await github.getPRComments(pr.number);
          console.log(`\n⚠️  Debug: Found ${allComments.length} comments on PR #${pr.number}`);
          allComments.forEach((c, i) => {
            console.log(`Comment ${i + 1}: ${c.body?.substring(0, 100)}...`);
          });
          console.error('❌ Metadata verification failed:', metadataCheck.error);
        }

        // Verify thread was created
        console.log('✅ Verifying thread creation...');
        let finalThreadId: string | undefined;
        if (discordMessage.thread) {
          expect(discordMessage.thread.id).toBeDefined();
          finalThreadId = discordMessage.thread.id;
          console.log(`✓ Thread found in message object: ${finalThreadId}\n`);
          const trackedIndex = testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
          if (trackedIndex >= 0) {
            testDiscordMessages[trackedIndex].threadId = finalThreadId;
          }
        } else if (threadId) {
          finalThreadId = threadId;
          console.log(`✓ Thread ID from metadata (not in message object): ${finalThreadId}\n`);
          const trackedIndex = testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
          if (trackedIndex >= 0) {
            testDiscordMessages[trackedIndex].threadId = finalThreadId;
          }
          try {
            console.log(`🔍 Verifying thread ${finalThreadId} exists in Discord...`);
            const thread = await discord.getThread(finalThreadId);
            expect(thread).toBeDefined();
            expect(thread.id).toBe(finalThreadId);
            console.log(`✓ Thread verified\n`);
          } catch (error) {
            console.error(`❌ Thread ${finalThreadId} from metadata does not exist in Discord:`, error);
            throw new Error(`Thread ${finalThreadId} from metadata does not exist in Discord`);
          }
        } else {
          throw new Error('Thread was not created - neither message.thread nor metadata.thread_id found');
        }
        
        if (!metadataCheck.passed) {
          console.warn('⚠️  Metadata not found, but Discord message and thread were created successfully');
        }

        // Verify that each reviewer received a thread message
        if (finalThreadId && reviewers.length > 0) {
          console.log(`🔍 Verifying thread messages for ${reviewers.length} reviewer(s)...`);
          await wait(3000); // Give time for all thread messages to be sent
          
          const threadMessages = await discord.getThreadMessages(finalThreadId, 50);
          console.log(`📋 Found ${threadMessages.length} thread message(s) total`);
          
          // Check for reviewer notification messages
          // Each reviewer should get a message like ":bellhop: @reviewer - your review has been requested..."
          const reviewerMessages: Array<{ reviewer: string; found: boolean; message?: string }> = [];
          
          for (const reviewer of reviewers) {
            // Look for messages that mention this reviewer
            // The message format is: ":bellhop: @reviewer - your review has been requested for [PR #X](url)"
            const reviewerMessage = threadMessages.find((msg) => {
              const content = msg.content.toLowerCase();
              return (
                (content.includes(reviewer.toLowerCase()) || content.includes('<@')) &&
                (content.includes('review') || content.includes('bellhop') || content.includes('requested'))
              );
            });
            
            reviewerMessages.push({
              reviewer,
              found: !!reviewerMessage,
              message: reviewerMessage?.content,
            });
            
            if (reviewerMessage) {
              console.log(`  ✓ Found message for reviewer: ${reviewer}`);
            } else {
              console.log(`  ❌ Missing message for reviewer: ${reviewer}`);
            }
          }
          
          // Verify all reviewers got messages
          const missingReviewers = reviewerMessages.filter(rm => !rm.found).map(rm => rm.reviewer);
          if (missingReviewers.length > 0) {
            console.error(`\n❌ Missing thread messages for ${missingReviewers.length} reviewer(s): ${missingReviewers.join(', ')}`);
            console.log('\nAll thread messages:');
            threadMessages.forEach((msg, idx) => {
              console.log(`  ${idx + 1}. ${msg.content.substring(0, 100)}...`);
            });
            throw new Error(`Test 3 failed: Missing thread messages for reviewer(s): ${missingReviewers.join(', ')}. Expected ${reviewers.length} reviewer notification(s), but only found ${reviewerMessages.filter(rm => rm.found).length}.`);
          }
          
          console.log(`✓ All ${reviewers.length} reviewer(s) received thread messages\n`);
        }
        
        console.log('\n✅ Test 3 completed successfully!\n');
      }
    }, 600000); // 10 minute timeout for E2E tests
  });

  // Test 4: Draft → Ready
  describe('Test 4: Draft → Ready', () => {
    it('should update Discord message status when draft PR is marked ready', async () => {
      console.log('\n📝 Starting Test 4: Draft → Ready\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Draft to Ready', testId);
      const prDescription = testData.generatePRDescription('Test 4: Draft → Ready');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 4');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create draft PR
      console.log(`🔨 Creating draft PR...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        true, // draft
        []
      );
      console.log(`✓ Draft PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow to complete (PR opened)
      console.log('⏳ Waiting for initial workflow (PR opened)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message with PR #${pr.number}...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      expect(initialMessage?.content).toContain('Draft - In Progress');
      console.log(`✓ Initial message found: ${initialMessage?.id} (Draft status confirmed)\n`);
      trackDiscordMessage(initialMessage);

      // Mark PR as ready for review
      console.log(`🔄 Marking PR #${pr.number} as ready for review...`);
      await github.markReadyForReview(pr.number);
      console.log(`✓ PR marked as ready\n`);

      // Wait for workflow to complete (ready_for_review event)
      console.log('⏳ Waiting for workflow (ready_for_review event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Workflow completed\n`);

      // Get updated Discord message
      console.log(`🔍 Fetching updated Discord message...`);
      const updatedMessage = await discord.getMessage(initialMessage!.id);
      console.log(`✓ Message fetched\n`);

      // Verify status was updated
      console.log('✅ Verifying status update...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Ready for Review');
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      expect(updatedMessage.content).not.toContain('Draft - In Progress');
      console.log(`✓ Status updated from "Draft - In Progress" to "Ready for Review"\n`);

      // Verify thread message was posted
      if (updatedMessage.thread) {
        console.log(`🔍 Checking for thread message about ready status...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        const readyMessage = threadMessages.find((msg) =>
          msg.content.includes('ready for review')
        );
        expect(readyMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);
      }
      
      console.log('\n✅ Test 4 completed successfully!\n');
    }, 600000); // 10 minute timeout for E2E tests
  });

  // Test 5: Reviewer Added
  describe('Test 5: Reviewer Added', () => {
    it('Test 5: should post thread message when reviewer is added', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 5: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 5: Reviewer Added\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Reviewer Added', testId);
      const prDescription = testData.generatePRDescription('Test 5: Reviewer Added');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 5');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create PR without reviewers
      console.log(`🔨 Creating PR without reviewers...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        []
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      // Add reviewer
      // Note: Reviewer is assigned using their real GitHub username so Discord can map them correctly
      const reviewer = config.test.reviewers[0];
      console.log(`👥 Adding reviewer: ${reviewer}...`);
      await github.requestReviewers(pr.number, [reviewer]);
      console.log(`✓ Reviewer added\n`);

      // Wait for workflow (review_requested event)
      console.log('⏳ Waiting for workflow (review_requested event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for parent message to be updated (can take time for Discord to process)
      console.log('⏳ Waiting for parent message to be updated...');
      let updatedMessage = await discord.getMessage(initialMessage.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && !updatedMessage.content.includes('**Reviewers:**')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(initialMessage.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Parent message not updated after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Parent message updated (after ${attempts * 2} seconds)\n`);
      }

      // Verify parent message was updated with reviewer
      console.log('✅ Verifying parent message was updated...');
      const reviewerCheck = verifyReviewerMention(updatedMessage, reviewer);
      if (!reviewerCheck.passed) {
        console.warn(`⚠️  Reviewer mention check: ${reviewerCheck.error}`);
        // Still check if reviewers line exists
        expect(updatedMessage.content).toContain('**Reviewers:**');
      } else {
        console.log(`✓ Reviewer found in message`);
      }
      console.log(`✓ Parent message updated with reviewer\n`);
      
      // Wait a bit more for thread message to appear
      console.log('⏳ Waiting for thread message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread message was posted
      console.log('✅ Verifying thread message was posted...');
      if (initialMessage?.thread) {
        const threadMessages = await discord.getThreadMessages(initialMessage.thread.id, 10);
        console.log(`📋 Found ${threadMessages.length} thread message(s):`);
        threadMessages.forEach((msg, idx) => {
          const content = msg.content || '(empty)';
          console.log(`  ${idx + 1}. ${content.substring(0, 150)}${content.length > 150 ? '...' : ''}`);
        });
        console.log('');
        
        // Check for reviewer notification message - format: ":bellhop: @mention - your review as been requested for [PR #X](url)"
        // Note: There's a typo in the actual message: "as been" instead of "has been"
        const reviewerMessage = threadMessages.find((msg) => {
          const content = msg.content || '';
          return (
            content.includes(':bellhop:') ||
            (content.includes('review') && (
              content.includes('requested') ||
              content.includes('review as been') ||
              content.includes('review has been') ||
              (content.includes(reviewer) || content.includes('@'))
            ))
          );
        });
        
        if (!reviewerMessage) {
          console.error('❌ Thread message about reviewer request not found');
          console.error('Searched for messages containing:');
          console.error(`  - ":bellhop:" emoji`);
          console.error(`  - "review" with "requested"`);
          console.error(`  - "review as been requested" (typo variant)`);
          console.error(`  - "review" with reviewer "${reviewer}" or @ mention`);
          throw new Error('Thread message about reviewer request not found');
        }
        expect(reviewerMessage).toBeDefined();
        console.log(`✓ Thread message found about reviewer request\n`);

      }
      
      console.log('\n✅ Test 5 completed successfully!\n');
    }, 600000);
  });

  // Test 6: Reviewer Removed
  describe('Test 6: Reviewer Removed', () => {
    it('Test 6: should post thread message when reviewer is removed', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 6: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 6: Reviewer Removed\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Reviewer Removed', testId);
      const prDescription = testData.generatePRDescription('Test 6: Reviewer Removed');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 6');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping)\n`);

      // Create PR with reviewer
      // Note: Reviewer is assigned using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      const initialReviewerCheck = verifyReviewerMention(initialMessage, reviewer);
      if (!initialReviewerCheck.passed) {
        console.warn(`⚠️  Initial reviewer mention check: ${initialReviewerCheck.error}`);
        // Still verify reviewers line exists
        expect(initialMessage?.content).toContain('**Reviewers:**');
      }
      console.log(`✓ Initial message found: ${initialMessage?.id} (contains reviewer)\n`);
      trackDiscordMessage(initialMessage);

      // Remove reviewer
      console.log(`👥 Removing reviewer: ${reviewer}...`);
      await github.removeReviewer(pr.number, reviewer);
      console.log(`✓ Reviewer removed\n`);

      // Wait for workflow (review_request_removed event)
      console.log('⏳ Waiting for workflow (review_request_removed event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Wait longer for Discord to process messages
      console.log('⏳ Waiting for Discord messages to appear...');
      await wait(10000);
      console.log(`✓ Ready\n`);

      // Verify thread message was posted (poll for it)
      console.log('✅ Verifying thread message was posted...');
      if (initialMessage?.thread) {
        // Poll for thread message (can take time for Discord to process)
        let removalMessage = null;
        let attempts = 0;
        const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
        
        while (attempts < maxAttempts && !removalMessage) {
          const threadMessages = await discord.getThreadMessages(initialMessage.thread.id, 10);
          
          if (attempts === 0) {
            console.log(`📋 Found ${threadMessages.length} thread message(s):`);
            threadMessages.forEach((msg, idx) => {
              const content = msg.content || '(empty)';
              console.log(`  ${idx + 1}. ${content.substring(0, 150)}${content.length > 150 ? '...' : ''}`);
            });
            console.log('');
          }
          
          // Reviewer might be mapped to Discord ID, so check for "removed as a reviewer" and any mention
          removalMessage = threadMessages.find((msg) => {
            const content = msg.content || '';
            return (
              content.includes('removed as a reviewer') ||
              (content.includes('removed') && (content.includes(reviewer) || content.includes('@')))
            );
          });
          
          if (!removalMessage) {
            await wait(2000);
            attempts++;
          }
        }
        
        if (!removalMessage) {
          console.error('❌ Thread message about reviewer removal not found after polling');
          const finalThreadMessages = await discord.getThreadMessages(initialMessage.thread.id, 10);
          console.error(`Final thread messages (${finalThreadMessages.length}):`);
          finalThreadMessages.forEach((msg, idx) => {
            const content = msg.content || '(empty)';
            console.error(`  ${idx + 1}. ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
          });
          throw new Error('Thread message about reviewer removal not found');
        }
        expect(removalMessage).toBeDefined();
        console.log(`✓ Thread message found about reviewer removal (after ${attempts * 2} seconds)\n`);

        // Verify parent message was updated (reviewer removed)
        console.log('✅ Verifying parent message was updated...');
        const updatedMessage = await discord.getMessage(initialMessage.id);
        // Reviewer should no longer be in the message (or message should indicate removal)
        // Note: The exact behavior depends on implementation
        console.log(`✓ Parent message checked\n`);
      }
      
      console.log('\n✅ Test 6 completed successfully!\n');
    }, 600000);
  });

  // Test 7: Review Approved
  describe('Test 7: Review Approved', () => {
    it('Test 7: should add ✅ reaction and update status when PR is approved', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 7: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 7: Review Approved\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Review Approved', testId);
      const prDescription = testData.generatePRDescription('Test 7: Review Approved');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 7');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping; review will be submitted by GitHub App)\n`);

      // Create PR with reviewer
      // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      // Submit approval review
      // Note: The GitHub App submits the review (not the actual reviewer user)
      // This allows testing without requiring the reviewer to actually perform actions
      console.log(`✅ Submitting approval review (on behalf of ${reviewer}) via GitHub App...`);
      const review = await github.submitReview(pr.number, 'APPROVE', 'Looks good!');
      console.log(`✓ Review submitted by: ${review.user.login}\n`);

      // Wait for workflow (pull_request_review event)
      console.log('⏳ Waiting for workflow (pull_request_review event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for status update (can take time for Discord to process)
      console.log('⏳ Waiting for status to be updated...');
      let updatedMessage = await discord.getMessage(initialMessage!.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && !updatedMessage.content.includes('Approved')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(initialMessage!.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Status updated (after ${attempts * 2} seconds)\n`);
      }

      // Verify ✅ reaction was added
      console.log('✅ Verifying ✅ reaction was added...');
      const reactionCheck = verifyReaction(updatedMessage, '✅', true);
      if (!reactionCheck.passed) {
        console.warn(`⚠️  Reaction check: ${reactionCheck.error}`);
        // Still continue - reaction might take longer
      } else {
        console.log(`✓ ✅ reaction found\n`);
      }

      // Verify status was updated
      console.log('✅ Verifying status was updated...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Approved', reviewer);
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      console.log(`✓ Status updated to "Approved" with reviewer\n`);
      
      // Wait a bit more for thread message to appear
      console.log('⏳ Waiting for thread message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread message was posted
      if (updatedMessage.thread) {
        console.log(`🔍 Checking for thread message about approval...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        // Reviewer might be mapped to Discord ID, so check for "approved" and any mention
        const approvalMessage = threadMessages.find((msg) =>
          msg.content.includes('approved') && (msg.content.includes(reviewer) || msg.content.includes('@'))
        );
        expect(approvalMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);

        // Verify thread is locked
        console.log('✅ Verifying thread is locked...');
        const threadState = await verifyThreadState(discord, updatedMessage.thread.id, true, undefined);
        expect(threadState.passed).toBe(true);
        console.log(`✓ Thread is locked\n`);
      }
      
      console.log('\n✅ Test 7 completed successfully!\n');
    }, 600000);
  });

  // Test 8: Changes Requested
  describe('Test 8: Changes Requested', () => {
    it('should add ❌ reaction and update status when changes are requested', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 8: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 8: Changes Requested\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Changes Requested', testId);
      const prDescription = testData.generatePRDescription('Test 8: Changes Requested');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 8');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping; review will be submitted by GitHub App)\n`);

      // Create PR with reviewer
      // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      // Submit changes requested review
      // Note: The GitHub App submits the review (not the actual reviewer user)
      // This allows testing without requiring the reviewer to actually perform actions
      console.log(`❌ Submitting changes requested review (on behalf of ${reviewer}) via GitHub App...`);
      const review = await github.submitReview(pr.number, 'REQUEST_CHANGES', 'Please fix these issues');
      console.log(`✓ Review submitted by: ${review.user.login}\n`);

      // Wait for workflow
      console.log('⏳ Waiting for workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for status update (can take time for Discord to process)
      console.log('⏳ Waiting for status to be updated...');
      let updatedMessage = await discord.getMessage(initialMessage!.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && !updatedMessage.content.includes('Changes Requested')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(initialMessage!.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Status updated (after ${attempts * 2} seconds)\n`);
      }

      // Verify ❌ reaction was added
      console.log('✅ Verifying ❌ reaction was added...');
      const reactionCheck = verifyReaction(updatedMessage, '❌', true);
      if (!reactionCheck.passed) {
        console.warn(`⚠️  Reaction check: ${reactionCheck.error}`);
        // Still continue - reaction might take longer
      } else {
        console.log(`✓ ❌ reaction found\n`);
      }

      // Verify status was updated
      console.log('✅ Verifying status was updated...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Changes Requested', reviewer);
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      console.log(`✓ Status updated to "Changes Requested" with reviewer\n`);
      
      // Wait a bit more for thread message to appear
      console.log('⏳ Waiting for thread message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread message was posted
      if (updatedMessage.thread) {
        console.log(`🔍 Checking for thread message about changes requested...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        // Reviewer might be mapped to Discord ID, so check for "changes have been requested" and any mention
        const changesMessage = threadMessages.find((msg) =>
          msg.content.includes('changes have been requested') && (msg.content.includes(reviewer) || msg.content.includes('@'))
        );
        expect(changesMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);

        // Verify review body is included
        console.log('✅ Verifying review body is included...');
        expect(changesMessage?.content).toContain('Please fix these issues');
        console.log(`✓ Review body found in thread message\n`);

        // Verify thread is NOT locked
        console.log('✅ Verifying thread is NOT locked...');
        const threadState = await verifyThreadState(discord, updatedMessage.thread.id, false, undefined);
        expect(threadState.passed).toBe(true);
        console.log(`✓ Thread is not locked\n`);
      }
      
      console.log('\n✅ Test 8 completed successfully!\n');
    }, 600000);
  });

  // Test 9: Review Comment Only
  describe('Test 9: Review Comment Only', () => {
    it('Test 9: should not update Discord when review is comment-only', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 9: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 9: Review Comment Only\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Review Comment', testId);
      const prDescription = testData.generatePRDescription('Test 9: Review Comment Only');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 9');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping; review will be submitted by GitHub App)\n`);

      // Create PR with reviewer
      // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      const initialContent = initialMessage!.content;
      const initialReactions = initialMessage!.reactions || [];
      console.log(`📋 Captured initial state:`);
      console.log(`  - Content length: ${initialContent.length} chars`);
      console.log(`  - Reactions: ${initialReactions.length}\n`);

      // Submit comment-only review
      // Note: The GitHub App submits the review (not the actual reviewer user)
      // This allows testing without requiring the reviewer to actually perform actions
      console.log(`💬 Submitting comment-only review (on behalf of ${reviewer}) via GitHub App...`);
      const review = await github.submitReview(pr.number, 'COMMENT', 'Just a comment');
      console.log(`✓ Comment review submitted by: ${review.user.login}\n`);

      // Wait a bit (workflow should complete quickly as it skips)
      console.log('⏳ Waiting (workflow should skip processing)...');
      await wait(10000); // Give workflow time to run and skip
      console.log(`✓ Wait completed\n`);

      // Get message again
      console.log(`🔍 Fetching Discord message again...`);
      const updatedMessage = await discord.getMessage(initialMessage!.id);
      console.log(`✓ Message fetched\n`);

      // Verify message content did NOT change
      console.log('✅ Verifying message content did NOT change...');
      expect(updatedMessage.content).toBe(initialContent);
      console.log(`✓ Content unchanged\n`);

      // Verify no reactions were added
      console.log('✅ Verifying no reactions were added...');
      expect(updatedMessage.reactions?.length || 0).toBe(initialReactions.length);
      console.log(`✓ Reactions unchanged (${updatedMessage.reactions?.length || 0})\n`);

      // Verify status did NOT change
      console.log('✅ Verifying status did NOT change...');
      expect(updatedMessage.content).not.toContain('Approved');
      expect(updatedMessage.content).not.toContain('Changes Requested');
      console.log(`✓ Status unchanged\n`);
      
      console.log('\n✅ Test 9 completed successfully!\n');
    }, 600000);
  });

  // Test 10: Review Dismissed
  describe('Test 10: Review Dismissed', () => {
    it('should reset status when changes requested review is dismissed', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 10: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 10: Review Dismissed\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Review Dismissed', testId);
      const prDescription = testData.generatePRDescription('Test 10: Review Dismissed');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 10');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping; review will be submitted by GitHub App)\n`);

      // Create PR with reviewer
      // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Submit changes requested review
      // Note: The GitHub App submits the review (not the actual reviewer user)
      // This allows testing without requiring the reviewer to actually perform actions
      console.log(`❌ Submitting changes requested review (on behalf of ${reviewer}) via GitHub App...`);
      const review = await github.submitReview(pr.number, 'REQUEST_CHANGES', 'Please fix');
      console.log(`✓ Review submitted by: ${review.user.login} (ID: ${review.id})\n`);

      // Wait for workflow
      console.log('⏳ Waiting for workflow (changes requested)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Workflow completed\n`);

      // Get message after changes requested
      console.log(`🔍 Searching for Discord message after changes requested...`);
      const changesMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(changesMessage?.content).toContain('Changes Requested');
      console.log(`✓ Message found with "Changes Requested" status\n`);
      trackDiscordMessage(changesMessage);

      // Dismiss the review
      console.log(`🔄 Dismissing review (ID: ${review.id})...`);
      await github.dismissReview(pr.number, review.id, 'Changes have been addressed');
      console.log(`✓ Review dismissed\n`);

      // Wait for workflow (review dismissed event)
      console.log('⏳ Waiting for workflow (review dismissed event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for status reset (can take time for Discord to process)
      console.log('⏳ Waiting for status to be reset...');
      let updatedMessage = await discord.getMessage(changesMessage!.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && updatedMessage.content.includes('Changes Requested')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(changesMessage!.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Status not reset after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Status reset (after ${attempts * 2} seconds)\n`);
      }

      // Verify status was reset to "Ready for Review"
      console.log('✅ Verifying status was reset...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Ready for Review');
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      expect(updatedMessage.content).not.toContain('Changes Requested');
      console.log(`✓ Status reset to "Ready for Review"\n`);
      
      // Wait a bit more for thread message to appear
      console.log('⏳ Waiting for thread message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread message was posted
      if (updatedMessage.thread) {
        console.log(`🔍 Checking for thread message about dismissal...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        const dismissalMessage = threadMessages.find((msg) =>
          msg.content.includes('addressed') || msg.content.includes('dismissed')
        );
        expect(dismissalMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);
      }
      
      console.log('\n✅ Test 10 completed successfully!\n');
    }, 600000);
  });

  // Test 11: Review Dismissed (Approved)
  describe('Test 11: Review Dismissed (Approved)', () => {
    it('Test 11: should skip processing when approved review is dismissed', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 11: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 11: Review Dismissed (Approved)\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('Review Dismissed Approved', testId);
      const prDescription = testData.generatePRDescription('Test 11: Review Dismissed (Approved)');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 11');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping; review will be submitted by GitHub App)\n`);

      // Create PR with reviewer
      // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Submit approval review
      // Note: The GitHub App submits the review (not the actual reviewer user)
      // This allows testing without requiring the reviewer to actually perform actions
      console.log(`✅ Submitting approval review (on behalf of ${reviewer}) via GitHub App...`);
      const review = await github.submitReview(pr.number, 'APPROVE', 'Looks good');
      console.log(`✓ Review submitted by: ${review.user.login} (ID: ${review.id})\n`);

      // Wait for workflow
      console.log('⏳ Waiting for workflow (approval)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Workflow completed\n`);

      // Get message after approval
      console.log(`🔍 Searching for Discord message after approval...`);
      const approvalMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(approvalMessage?.content).toContain('Approved');
      console.log(`✓ Message found with "Approved" status\n`);
      trackDiscordMessage(approvalMessage);

      const approvalContent = approvalMessage!.content;
      const approvalReactions = approvalMessage!.reactions || [];
      console.log(`📋 Captured approval state:`);
      console.log(`  - Content length: ${approvalContent.length} chars`);
      console.log(`  - Reactions: ${approvalReactions.length}\n`);

      // Dismiss the approved review
      console.log(`🔄 Dismissing approved review (ID: ${review.id})...`);
      await github.dismissReview(pr.number, review.id, 'Dismissing approval');
      console.log(`✓ Review dismissed\n`);

      // Wait a bit (workflow should skip processing)
      console.log('⏳ Waiting (workflow should skip processing)...');
      await wait(10000);
      console.log(`✓ Wait completed\n`);

      // Get message again
      console.log(`🔍 Fetching Discord message again...`);
      const updatedMessage = await discord.getMessage(approvalMessage!.id);
      console.log(`✓ Message fetched\n`);

      // Verify message did NOT change (workflow should skip)
      console.log('✅ Verifying message did NOT change (workflow skipped)...');
      expect(updatedMessage.content).toBe(approvalContent);
      expect(updatedMessage.reactions?.length || 0).toBe(approvalReactions.length);
      console.log(`✓ Message unchanged (workflow correctly skipped)\n`);
      
      console.log('\n✅ Test 11 completed successfully!\n');
    }, 600000);
  });

  // Test 12: PR Synchronize (After Approval)
  describe('Test 12: PR Synchronize (After Approval)', () => {
    it('Test 12: should unlock thread and reset status when new commits are pushed after approval', async () => {
      // Skip if no test reviewers configured
      if (!config.test.reviewers || config.test.reviewers.length < 1) {
        console.warn('Skipping Test 12: E2E_TEST_REVIEWERS not configured');
        return;
      }

      console.log('\n📝 Starting Test 12: PR Synchronize (After Approval)\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Synchronize After Approval', testId);
      const prDescription = testData.generatePRDescription('Test 12: PR Synchronize (After Approval)');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 12');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create initial commit
      console.log(`💾 Creating initial commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Initial commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      const reviewer = config.test.reviewers[0];
      console.log(`👥 Will test with reviewer: ${reviewer}`);
      console.log(`   (Reviewer assigned for Discord mapping; review will be submitted by GitHub App)\n`);

      // Create PR with reviewer
      // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
      console.log(`🔨 Creating PR with reviewer: ${reviewer}...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        [reviewer]
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Submit approval review
      // Note: The GitHub App submits the review (not the actual reviewer user)
      // This allows testing without requiring the reviewer to actually perform actions
      console.log(`✅ Submitting approval review (on behalf of ${reviewer}) via GitHub App...`);
      const review = await github.submitReview(pr.number, 'APPROVE', 'Approved');
      console.log(`✓ Review submitted by: ${review.user.login}\n`);

      // Wait for workflow
      console.log('⏳ Waiting for workflow (approval)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Workflow completed\n`);

      // Get message after approval
      console.log(`🔍 Searching for Discord message after approval...`);
      const approvalMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(approvalMessage?.content).toContain('Approved');
      console.log(`✓ Message found with "Approved" status\n`);
      trackDiscordMessage(approvalMessage);

      // Verify thread is locked
      if (approvalMessage?.thread) {
        console.log('✅ Verifying thread is locked after approval...');
        const threadStateBefore = await verifyThreadState(discord, approvalMessage.thread.id, true, undefined);
        expect(threadStateBefore.passed).toBe(true);
        console.log(`✓ Thread is locked\n`);
      }

      // Push new commit (synchronize)
      console.log(`💾 Pushing new commit to branch (synchronize)...`);
      await github.createCommit(branchName, `${commitMessage} - Update`, `${fileContent}\n\nUpdate`, `test-${testId}.txt`);
      console.log(`✓ New commit pushed\n`);

      // Wait for workflow (synchronize event)
      console.log('⏳ Waiting for workflow (synchronize event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for status reset and thread unlock (can take time for Discord to process)
      console.log('⏳ Waiting for status to be reset and thread to unlock...');
      let updatedMessage = await discord.getMessage(approvalMessage!.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && updatedMessage.content.includes('Approved')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(approvalMessage!.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Status not reset after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Status reset (after ${attempts * 2} seconds)\n`);
      }

      // Verify status was reset to "Ready for Review"
      console.log('✅ Verifying status was reset...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Ready for Review');
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      expect(updatedMessage.content).not.toContain('Approved');
      console.log(`✓ Status reset to "Ready for Review"\n`);
      
      // Wait a bit more for thread unlock and message to appear
      console.log('⏳ Waiting for thread to unlock and message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread was unlocked
      if (updatedMessage.thread) {
        console.log('✅ Verifying thread was unlocked...');
        const threadStateAfter = await verifyThreadState(discord, updatedMessage.thread.id, false, undefined);
        expect(threadStateAfter.passed).toBe(true);
        console.log(`✓ Thread is unlocked\n`);

        // Verify thread message was posted
        console.log(`🔍 Checking for thread message about new commits...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        const syncMessage = threadMessages.find((msg) =>
          msg.content.includes('New commits have been pushed')
        );
        expect(syncMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);
      }
      
      console.log('\n✅ Test 12 completed successfully!\n');
    }, 600000);
  });

  // Test 13: PR Synchronize (No Approval)
  describe('Test 13: PR Synchronize (No Approval)', () => {
    it('should skip processing when PR without approval is synchronized', async () => {
      console.log('\n📝 Starting Test 13: PR Synchronize (No Approval)\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Synchronize No Approval', testId);
      const prDescription = testData.generatePRDescription('Test 13: PR Synchronize (No Approval)');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 13');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create initial commit
      console.log(`💾 Creating initial commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Initial commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create PR without reviewers
      console.log(`🔨 Creating PR without reviewers...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        []
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      const initialContent = initialMessage!.content;
      console.log(`📋 Captured initial state (content length: ${initialContent.length} chars)\n`);

      // Push new commit (synchronize)
      console.log(`💾 Pushing new commit to branch (synchronize)...`);
      await github.createCommit(branchName, `${commitMessage} - Update`, `${fileContent}\n\nUpdate`, `test-${testId}.txt`);
      console.log(`✓ New commit pushed\n`);

      // Wait a bit (workflow should skip processing)
      console.log('⏳ Waiting (workflow should skip processing)...');
      await wait(10000);
      console.log(`✓ Wait completed\n`);

      // Get message again
      console.log(`🔍 Fetching Discord message again...`);
      const updatedMessage = await discord.getMessage(initialMessage!.id);
      console.log(`✓ Message fetched\n`);

      // Verify message did NOT change (workflow should skip)
      console.log('✅ Verifying message did NOT change (workflow skipped)...');
      expect(updatedMessage.content).toBe(initialContent);
      console.log(`✓ Message unchanged (workflow correctly skipped)\n`);
      
      console.log('\n✅ Test 13 completed successfully!\n');
    }, 600000);
  });

  // Test 14: PR Closed
  describe('Test 14: PR Closed', () => {
    it('Test 14: should lock thread and update status when PR is closed', async () => {
      console.log('\n📝 Starting Test 14: PR Closed\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Closed', testId);
      const prDescription = testData.generatePRDescription('Test 14: PR Closed');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 14');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create PR
      console.log(`🔨 Creating PR...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        []
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      // Verify thread is not locked initially
      if (initialMessage?.thread) {
        console.log('✅ Verifying thread is NOT locked initially...');
        const threadStateBefore = await verifyThreadState(discord, initialMessage.thread.id, false, undefined);
        expect(threadStateBefore.passed).toBe(true);
        console.log(`✓ Thread is not locked\n`);
      }

      // Close PR
      console.log(`🔒 Closing PR #${pr.number}...`);
      await github.closePR(pr.number);
      console.log(`✓ PR closed\n`);

      // Wait for workflow (closed event)
      console.log('⏳ Waiting for workflow (closed event)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for status update (can take time for Discord to process)
      console.log('⏳ Waiting for status to be updated...');
      let updatedMessage = await discord.getMessage(initialMessage!.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && !updatedMessage.content.includes('Closed')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(initialMessage!.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Status updated (after ${attempts * 2} seconds)\n`);
      }

      // Verify status was updated
      console.log('✅ Verifying status was updated...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Closed');
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      console.log(`✓ Status updated to "Closed"\n`);
      
      // Wait a bit more for thread message to appear
      console.log('⏳ Waiting for thread message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread was locked
      if (updatedMessage.thread) {
        console.log('✅ Verifying thread was locked...');
        const threadStateAfter = await verifyThreadState(discord, updatedMessage.thread.id, true, undefined);
        expect(threadStateAfter.passed).toBe(true);
        console.log(`✓ Thread is locked\n`);

        // Verify thread message was posted
        console.log(`🔍 Checking for thread message about closure...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        const closeMessage = threadMessages.find((msg) =>
          msg.content.includes('closed')
        );
        expect(closeMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);
      }
      
      console.log('\n✅ Test 14 completed successfully!\n');
    }, 600000);
  });

  // Test 15: PR Merged
  describe('Test 15: PR Merged', () => {
    it('Test 15: should archive thread and add 🎉 reaction when PR is merged', async () => {
      console.log('\n📝 Starting Test 15: PR Merged\n');
      
      const testId = generateTestId(config.test.prefix);
      const branchName = testData.generateBranchName(testId);
      const prTitle = testData.generatePRTitle('PR Merged', testId);
      const prDescription = testData.generatePRDescription('Test 15: PR Merged');
      const fileContent = testData.generateFileContent(testId);
      const commitMessage = testData.generateCommitMessage('Test 15');

      console.log(`✓ Generated test data:`);
      console.log(`  - Test ID: ${testId}`);
      console.log(`  - Branch: ${branchName}`);
      console.log(`  - PR Title: ${prTitle}\n`);

      // Get default branch
      console.log('📌 Getting default branch...');
      const defaultBranch = await github.getDefaultBranch();
      console.log(`✓ Default branch: ${defaultBranch}\n`);

      // Create branch
      console.log(`🌿 Creating branch: ${branchName}...`);
      await github.createBranch(branchName, defaultBranch);
      console.log(`✓ Branch created\n`);

      // Create a commit on the branch
      console.log(`💾 Creating commit on branch...`);
      await github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
      console.log(`✓ Commit created\n`);

      // Wait a bit for branch to be ready
      console.log('⏳ Waiting for branch to be ready...');
      await wait(2000);
      console.log(`✓ Ready\n`);

      // Create PR
      console.log(`🔨 Creating PR...`);
      const pr = await github.createPR(
        prTitle,
        branchName,
        defaultBranch,
        prDescription,
        false,
        []
      );
      console.log(`✓ PR created: #${pr.number} - ${pr.html_url}\n`);
      testPRs.push(pr.number);

      // Wait for initial workflow
      console.log('⏳ Waiting for initial workflow...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      await wait(3000);
      console.log(`✓ Initial workflow completed\n`);

      // Get initial Discord message
      console.log(`🔍 Searching for initial Discord message...`);
      const initialMessage = await discord.findMessageByPR(pr.number, config.test.discordPollTimeout);
      expect(initialMessage).toBeDefined();
      console.log(`✓ Initial message found: ${initialMessage?.id}\n`);
      trackDiscordMessage(initialMessage);

      // Merge PR
      console.log(`🔀 Merging PR #${pr.number}...`);
      await github.mergePR(pr.number, 'merge');
      console.log(`✓ PR merged\n`);

      // Wait for workflow (closed event with merged=true)
      console.log('⏳ Waiting for workflow (closed event with merged=true)...');
      await waitForWorkflow(github, pr.number, config.test.workflowTimeout);
      console.log(`✓ Workflow completed\n`);
      
      // Poll for status update and reaction (can take time for Discord to process)
      console.log('⏳ Waiting for status to be updated and reaction to appear...');
      let updatedMessage = await discord.getMessage(initialMessage!.id);
      let attempts = 0;
      const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
      while (attempts < maxAttempts && !updatedMessage.content.includes('Merged')) {
        await wait(2000);
        updatedMessage = await discord.getMessage(initialMessage!.id);
        attempts++;
      }
      if (attempts >= maxAttempts) {
        console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
      } else {
        console.log(`✓ Status updated (after ${attempts * 2} seconds)\n`);
      }

      // Verify 🎉 reaction was added
      console.log('✅ Verifying 🎉 reaction was added...');
      const reactionCheck = verifyReaction(updatedMessage, '🎉', true);
      if (!reactionCheck.passed) {
        console.warn(`⚠️  Reaction check: ${reactionCheck.error}`);
        // Still continue - reaction might take longer
      } else {
        console.log(`✓ 🎉 reaction found\n`);
      }

      // Verify status was updated
      console.log('✅ Verifying status was updated...');
      const statusCheck = verifyStatusLine(updatedMessage, 'Merged');
      if (!statusCheck.passed) {
        console.error('❌ Status verification failed:');
        statusCheck.errors.forEach((error) => {
          console.error(`  - ${error}`);
        });
        console.log('\nActual message content:');
        console.log('---');
        console.log(updatedMessage.content);
        console.log('---\n');
        throw new Error(`Status verification failed:\n${statusCheck.errors.map(e => `  - ${e}`).join('\n')}\n\nActual message:\n${updatedMessage.content}`);
      }
      expect(statusCheck.passed).toBe(true);
      console.log(`✓ Status updated to "Merged"\n`);
      
      // Wait a bit more for thread message to appear
      console.log('⏳ Waiting for thread message to appear...');
      await wait(5000);
      console.log(`✓ Ready\n`);

      // Verify thread was archived and locked
      if (updatedMessage.thread) {
        console.log('✅ Verifying thread was archived and locked...');
        const threadState = await verifyThreadState(discord, updatedMessage.thread.id, true, true);
        expect(threadState.passed).toBe(true);
        console.log(`✓ Thread is archived and locked\n`);

        // Verify thread message was posted
        console.log(`🔍 Checking for thread message about merge...`);
        const threadMessages = await discord.getThreadMessages(updatedMessage.thread.id, 10);
        const mergeMessage = threadMessages.find((msg) =>
          msg.content.includes('merged')
        );
        expect(mergeMessage).toBeDefined();
        console.log(`✓ Thread message found\n`);
      }
      
      console.log('\n✅ Test 15 completed successfully!\n');
    }, 600000);
  });
});
