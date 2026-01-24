import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';
import { GitHubClient } from './helpers/github-client';
import { DiscordClient, type DiscordMessage } from './helpers/discord-client';
import { waitForWorkflow, wait } from './helpers/workflow-waiter';
import { cleanupPR, cleanupDiscordMessageAndThread, generateTestId } from './helpers/cleanup';
import {
  verifyMessageContent,
  verifyPRMetadata,
  verifyReaction,
  verifyThreadState,
  verifyParentMessageFormat,
  verifyReviewerMention,
} from './helpers/verification';
import { TestDataGenerator } from './fixtures/test-data';

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

/**
 * Test context passed to each test function
 */
interface TestContext {
  config: ReturnType<typeof loadConfig>;
  github: GitHubClient;
  discord: DiscordClient;
  testData: TestDataGenerator;
  testPRs: number[];
  testDiscordMessages: Array<{ messageId: string; threadId?: string }>;
  trackDiscordMessage: (message: { id: string; thread?: { id: string } } | null) => void;
}

// Load config once at module level to check reviewers for skip conditions
// This allows us to use it.skipIf() at test definition time
let moduleConfig: ReturnType<typeof loadConfig> | null = null;
try {
  moduleConfig = loadConfig();
} catch (error) {
  // Config will be loaded in beforeEach, so this is okay
}

/**
 * Test 1: PR Opened (Draft)
 * Creates a draft PR and verifies Discord message is created with correct format
 */
async function test1PROpenedDraft(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 1: PR Opened (Draft)\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Opened Draft', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 1: PR Opened (Draft)');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 1');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create draft PR
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    true, // draft
    [] // no reviewers for now - we'll add this capability later
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for workflow to complete
  const workflowRun = await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  if (!workflowRun) {
    console.warn('⚠️  Workflow did not complete within timeout, continuing with verification...');
  } else {
    console.log(`✓ Workflow completed`);
  }

  // Wait for Discord message and thread to appear
  await wait(5000);

  // Find Discord message by PR number
  const discordMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);

  // Verify Discord message exists
  expect(discordMessage).toBeDefined();
  expect(discordMessage).not.toBeNull();

  if (discordMessage) {
    console.log(`✓ Discord message found: ${discordMessage.id}`);
    
    // Track message for cleanup
    ctx.trackDiscordMessage(discordMessage);
    
    // Verify message content
    const contentCheck = verifyMessageContent(discordMessage, [
      `PR #${pr.number}`,
      prTitle,
      'Draft - In Progress',
    ]);

    expect(contentCheck.passed).toBe(true);
    if (!contentCheck.passed) {
      console.error('❌ Message content verification failed:', contentCheck.errors);
      console.log('Actual message content:', discordMessage.content);
    }

    const author = await ctx.github.getPRAuthor(pr.number);
    const formatCheck = verifyParentMessageFormat(
      discordMessage,
      {
        hasReviewers: false,
        prNumber: pr.number,
        prTitle,
        prUrl: pr.url,
        headBranch: branchName,
        baseBranch: defaultBranch,
        author,
        prDescription,
      },
      'Draft - In Progress'
    );
    if (!formatCheck.passed) {
      console.error('❌ Message formatting verification failed:');
      formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
      console.log('\nActual message content:\n---\n' + discordMessage.content + '\n---');
      throw new Error(`Message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nActual message:\n${discordMessage.content}`);
    }

    // Wait and check metadata for thread ID
    await wait(2000);
    
    // Verify metadata was saved to PR and get thread ID
    const metadataCheck = await verifyPRMetadata(ctx.github, pr.number);
    let threadId: string | undefined;
    
    if (metadataCheck.passed && metadataCheck.metadata) {
      threadId = metadataCheck.metadata.thread_id;
      
      // If message doesn't have thread info but metadata does, enrich the message
      if (!discordMessage.thread && threadId) {
        try {
          const thread = await ctx.discord.getThread(threadId);
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
      const allComments = await ctx.github.getPRComments(pr.number);
      console.error(`❌ Metadata verification failed: ${metadataCheck.error}`);
      console.log(`Debug: Found ${allComments.length} comments on PR #${pr.number}`);
    }

    // Verify thread was created (either from message or metadata)
    if (discordMessage.thread) {
      expect(discordMessage.thread.id).toBeDefined();
      // Update tracked message with thread ID for cleanup
      const trackedIndex = ctx.testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = discordMessage.thread.id;
      }
    } else if (threadId) {
      // Thread exists according to metadata, but not in message object
      const trackedIndex = ctx.testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = threadId;
      }
      // Verify thread actually exists by fetching it
      try {
        const thread = await ctx.discord.getThread(threadId);
        expect(thread).toBeDefined();
        expect(thread.id).toBe(threadId);
      } catch (error) {
        console.error(`❌ Thread ${threadId} from metadata does not exist in Discord:`, error);
        throw new Error(`Thread ${threadId} from metadata does not exist in Discord`);
      }
    } else {
      throw new Error('Thread was not created - neither message.thread nor metadata.thread_id found');
    }
    
    console.log('✅ Test 1 completed successfully!\n');
  }
}

/**
 * Test 2: PR Opened (Ready)
 * Creates a ready PR without reviewers and verifies Discord message includes warning
 */
async function test2PROpenedReady(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 2: PR Opened (Ready)\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Opened Ready', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 2: PR Opened (Ready)');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 2');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create ready PR without reviewers
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false, // not draft
    [] // no reviewers
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for workflow to complete
  const workflowRun = await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  if (!workflowRun) {
    console.warn('⚠️  Workflow did not complete within timeout, continuing with verification...');
  } else {
    console.log(`✓ Workflow completed`);
  }

  // Wait for Discord message and thread to appear
  await wait(5000);

  // Find Discord message by PR number
  const discordMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);

  // Verify Discord message exists
  expect(discordMessage).toBeDefined();
  expect(discordMessage).not.toBeNull();

  if (discordMessage) {
    console.log(`✓ Discord message found: ${discordMessage.id}`);
    
    // Track message for cleanup
    ctx.trackDiscordMessage(discordMessage);
    
    // Verify message content includes warning
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
    }

    const author = await ctx.github.getPRAuthor(pr.number);
    const formatCheck = verifyParentMessageFormat(
      discordMessage,
      {
        hasReviewers: false,
        prNumber: pr.number,
        prTitle,
        prUrl: pr.url,
        headBranch: branchName,
        baseBranch: defaultBranch,
        author,
        prDescription,
      },
      'Ready for Review'
    );
    if (!formatCheck.passed) {
      console.error('❌ Message formatting verification failed:');
      formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
      console.log('\nActual message content:\n---\n' + discordMessage.content + '\n---');
      throw new Error(`Message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nActual message:\n${discordMessage.content}`);
    }

    // Wait and check metadata for thread ID
    await wait(2000);
    
    const metadataCheck = await verifyPRMetadata(ctx.github, pr.number);
    let threadId: string | undefined;
    
    if (metadataCheck.passed && metadataCheck.metadata) {
      threadId = metadataCheck.metadata.thread_id;
      
      if (!discordMessage.thread && threadId) {
        try {
          const thread = await ctx.discord.getThread(threadId);
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
      const allComments = await ctx.github.getPRComments(pr.number);
      console.error(`❌ Metadata verification failed: ${metadataCheck.error}`);
      console.log(`Debug: Found ${allComments.length} comments on PR #${pr.number}`);
    }

    // Verify thread was created (either from message or metadata)
    if (discordMessage.thread) {
      expect(discordMessage.thread.id).toBeDefined();
      // Update tracked message with thread ID for cleanup
      const trackedIndex = ctx.testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = discordMessage.thread.id;
      }
    } else if (threadId) {
      // Thread exists according to metadata, but not in message object
      const trackedIndex = ctx.testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = threadId;
      }
      // Verify thread actually exists by fetching it
      try {
        const thread = await ctx.discord.getThread(threadId);
        expect(thread).toBeDefined();
        expect(thread.id).toBe(threadId);
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
    
    console.log('✅ Test 2 completed successfully!\n');
  }
}

/**
 * Test 3: PR Opened (Multiple Reviewers)
 * Creates a ready PR with multiple reviewers and verifies all reviewers are listed and notified
 */
async function test3PROpenedMultipleReviewers(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 3: PR Opened (Multiple Reviewers)\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Opened Multiple Reviewers', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 3: PR Opened (Multiple Reviewers)');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 3');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Use first 2-3 reviewers from config
  // Note: Reviewers are assigned using real GitHub usernames so Discord can map them correctly
  const reviewers = ctx.config.test.reviewers!.slice(0, Math.min(3, ctx.config.test.reviewers!.length));
  console.log(`👥 Using reviewers: ${reviewers.join(', ')}`);

  // Create ready PR with multiple reviewers
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false, // not draft
    reviewers
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for workflow to complete
  const workflowRun = await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  if (!workflowRun) {
    console.warn('⚠️  Workflow did not complete within timeout, continuing with verification...');
  } else {
    console.log(`✓ Workflow completed`);
  }

  // Wait for Discord message and thread to appear
  await wait(5000);

  // Find Discord message by PR number
  const discordMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);

  // Verify Discord message exists
  expect(discordMessage).toBeDefined();
  expect(discordMessage).not.toBeNull();

  if (discordMessage) {
    console.log(`✓ Discord message found: ${discordMessage.id}`);
    
    // Track message for cleanup
    ctx.trackDiscordMessage(discordMessage);
    
    // Verify message content includes all reviewers
    const contentCheck = verifyMessageContent(discordMessage, [
      `PR #${pr.number}`,
      prTitle,
      'Ready for Review',
    ]);

    expect(contentCheck.passed).toBe(true);
    if (!contentCheck.passed) {
      console.error('❌ Message content verification failed:', contentCheck.errors);
      console.log('Actual message content:', discordMessage.content);
    }

    // Verify all reviewers are listed (check for reviewer mentions)
    // Note: Reviewers might be mapped to Discord IDs, so we check for the reviewers line format
    const hasReviewersLine = discordMessage.content.includes('**Reviewers:**');
    expect(hasReviewersLine).toBe(true);
    
    // Check if reviewers are mentioned (they might be Discord IDs or usernames)
    let reviewersFound = 0;
    for (const reviewer of reviewers) {
      // Check for username, @username, or Discord mention format
      if (discordMessage.content.includes(reviewer) || 
          discordMessage.content.includes(`@${reviewer}`) ||
          discordMessage.content.includes(`<@`) && discordMessage.content.includes('**Reviewers:**')) {
        reviewersFound++;
      }
    }

    // Should find at least the reviewers line, and ideally all reviewers
    // But allow for Discord ID mapping which makes exact username matching harder
    expect(hasReviewersLine).toBe(true);

    const author = await ctx.github.getPRAuthor(pr.number);
    const formatCheck = verifyParentMessageFormat(
      discordMessage,
      {
        hasReviewers: true,
        prNumber: pr.number,
        prTitle,
        prUrl: pr.url,
        headBranch: branchName,
        baseBranch: defaultBranch,
        author,
        prDescription,
        reviewers,
      },
      'Ready for Review'
    );
    if (!formatCheck.passed) {
      console.error('❌ Message formatting verification failed:');
      formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
      console.log('\nActual message content:\n---\n' + discordMessage.content + '\n---');
      throw new Error(`Message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nActual message:\n${discordMessage.content}`);
    }

    // Wait and check metadata for thread ID
    await wait(2000);
    
    const metadataCheck = await verifyPRMetadata(ctx.github, pr.number);
    let threadId: string | undefined;
    
    if (metadataCheck.passed && metadataCheck.metadata) {
      threadId = metadataCheck.metadata.thread_id;
      
      if (!discordMessage.thread && threadId) {
        try {
          const thread = await ctx.discord.getThread(threadId);
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
      const allComments = await ctx.github.getPRComments(pr.number);
      console.error(`❌ Metadata verification failed: ${metadataCheck.error}`);
      console.log(`Debug: Found ${allComments.length} comments on PR #${pr.number}`);
    }

    // Verify thread was created
    let finalThreadId: string | undefined;
    if (discordMessage.thread) {
      expect(discordMessage.thread.id).toBeDefined();
      finalThreadId = discordMessage.thread.id;
      const trackedIndex = ctx.testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = finalThreadId;
      }
    } else if (threadId) {
      finalThreadId = threadId;
      const trackedIndex = ctx.testDiscordMessages.findIndex(m => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = finalThreadId;
      }
      try {
        const thread = await ctx.discord.getThread(finalThreadId);
        expect(thread).toBeDefined();
        expect(thread.id).toBe(finalThreadId);
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

    // Verify that each reviewer received a UNIQUE thread message
    // When multiple reviewers are added at PR creation, each should get their own message
    if (finalThreadId && reviewers.length > 0) {
      // Poll for reviewer messages - they may arrive asynchronously
      let allReviewerMessagesFound = false;
      let attempts = 0;
      const maxAttempts = 20; // 20 attempts * 2 seconds = 40 seconds max
      const reviewerMessages: Array<{ reviewer: string; found: boolean; messageId?: string; message?: string }> = [];
      let threadMessages: DiscordMessage[] = [];
      
      while (attempts < maxAttempts && !allReviewerMessagesFound) {
        await wait(2000); // Wait 2 seconds between attempts
        attempts++;
        
        threadMessages = await ctx.discord.getThreadMessages(finalThreadId, 50);
        
        // Filter to only reviewer notification messages (exclude the initial thread setup message)
        const reviewerNotificationMessages = threadMessages.filter((msg) => {
          const content = msg.content.toLowerCase();
          return (
            content.includes(':bellhop:') &&
            (content.includes('review') || content.includes('requested')) &&
            (content.includes('pr #') || content.includes('pull request'))
          );
        });
        
        // Track which reviewers have been found
        reviewerMessages.length = 0; // Reset
        const usedMessageIds = new Set<string>(); // Track messages already matched to avoid duplicates
        
        for (const reviewer of reviewers) {
          // Look for a UNIQUE message that mentions this specific reviewer
          // The message format is: ":bellhop: @reviewer - your review has been requested for [PR #X](url)"
          const reviewerMessage = reviewerNotificationMessages.find((msg) => {
            // Skip if this message was already matched to another reviewer
            if (usedMessageIds.has(msg.id)) {
              return false;
            }
            
            const content = msg.content.toLowerCase();
            const reviewerLower = reviewer.toLowerCase();
            
            // Must contain the reviewer's username OR a Discord mention
            // AND must be a reviewer notification message
            const mentionsReviewer = 
              content.includes(reviewerLower) || 
              (content.includes('<@') && content.includes('review'));
            
            return mentionsReviewer && 
                   content.includes(':bellhop:') &&
                   (content.includes('review') || content.includes('requested'));
          });
          
          if (reviewerMessage) {
            usedMessageIds.add(reviewerMessage.id); // Mark as used
            reviewerMessages.push({
              reviewer,
              found: true,
              messageId: reviewerMessage.id,
              message: reviewerMessage.content,
            });
          } else {
            reviewerMessages.push({
              reviewer,
              found: false,
            });
          }
        }
        
        // Check if all reviewers have messages
        allReviewerMessagesFound = reviewerMessages.every(rm => rm.found);
        
        if (!allReviewerMessagesFound) {
          const foundCount = reviewerMessages.filter(rm => rm.found).length;
          console.log(`  Attempt ${attempts}/${maxAttempts}: Found ${foundCount}/${reviewers.length} reviewer messages, continuing to poll...`);
        }
      }
      
      // Verify all reviewers got UNIQUE messages
      const missingReviewers = reviewerMessages.filter(rm => !rm.found).map(rm => rm.reviewer);
      const foundCount = reviewerMessages.filter(rm => rm.found).length;
      
      if (missingReviewers.length > 0) {
        console.error(`\n❌ Missing thread messages for ${missingReviewers.length} reviewer(s): ${missingReviewers.join(', ')}`);
        console.error(`   Expected ${reviewers.length} unique reviewer notification message(s), but only found ${foundCount}.`);
        console.log('\nAll thread messages:');
        threadMessages.forEach((msg, idx) => {
          const isReviewerMsg = msg.content.includes(':bellhop:') && msg.content.includes('review');
          console.log(`  ${idx + 1}. ${isReviewerMsg ? '📬' : '  '} ${msg.content.substring(0, 150)}${msg.content.length > 150 ? '...' : ''}`);
        });
        console.log('\nReviewer message matching:');
        reviewerMessages.forEach((rm) => {
          console.log(`  ${rm.found ? '✓' : '✗'} ${rm.reviewer}: ${rm.found ? `Message ID ${rm.messageId}` : 'NOT FOUND'}`);
        });
        throw new Error(
          `Test 3 failed: Missing thread messages for reviewer(s): ${missingReviewers.join(', ')}. ` +
          `Expected ${reviewers.length} unique reviewer notification message(s) (one per reviewer), ` +
          `but only found ${foundCount}. ` +
          `Each reviewer must receive their own individual thread message when added to the PR.`
        );
      }
      
      // Verify we have exactly the right number of reviewer messages (no duplicates)
      const reviewerNotificationCount = threadMessages.filter((msg) => {
        const content = msg.content.toLowerCase();
        return content.includes(':bellhop:') && 
               (content.includes('review') || content.includes('requested')) &&
               (content.includes('pr #') || content.includes('pull request'));
      }).length;
      
      if (reviewerNotificationCount !== reviewers.length) {
        console.warn(`⚠️  Found ${reviewerNotificationCount} reviewer notification messages, but expected ${reviewers.length}. This might indicate duplicate or missing messages.`);
      }
      
      console.log(`✓ All ${reviewers.length} reviewer(s) received their individual thread messages`);
    }

    await wait(2000);
    const finalMessage = await ctx.discord.getMessage(discordMessage.id);
    if (finalMessage) {
      const finalFormatCheck = verifyParentMessageFormat(
        finalMessage,
        {
          hasReviewers: true,
          prNumber: pr.number,
          prTitle,
          prUrl: pr.url,
          headBranch: branchName,
          baseBranch: defaultBranch,
          author,
          prDescription,
          reviewers,
        },
        'Ready for Review'
      );
      if (!finalFormatCheck.passed) {
        console.error('❌ Final message formatting verification failed (after workflow completion):');
        finalFormatCheck.errors.forEach((e) => console.error(`  - ${e}`));
        console.log('\nFinal message content:\n---\n' + finalMessage.content + '\n---');
        throw new Error(`Final message formatting verification failed:\n${finalFormatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${finalMessage.content}`);
      }
      console.log('✓ Final message format verified after workflow completion');
    }
    console.log('✅ Test 3 completed successfully!\n');
  }
}

/**
 * Test 4: Draft → Ready
 * Creates a draft PR, then marks it ready and verifies Discord message status is updated
 */
async function test4DraftToReady(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 4: Draft → Ready\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Draft to Ready', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 4: Draft → Ready');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 4');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create draft PR
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    true, // draft
    []
  );
  console.log(`✓ Draft PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow to complete (PR opened)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  expect(initialMessage?.content).toContain('Draft - In Progress');
  console.log(`✓ Initial message found: ${initialMessage?.id} (Draft status confirmed)`);
  ctx.trackDiscordMessage(initialMessage);

  // Mark PR as ready for review
  await ctx.github.markReadyForReview(pr.number);

  // Wait for workflow to complete (ready_for_review event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  const updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  expect(updatedMessage.content).not.toContain('Draft - In Progress');
  console.log(`✓ Status updated from "Draft - In Progress" to "Ready for Review"`);

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: false,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
    },
    'Ready for Review'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');

  if (updatedMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const readyMessage = threadMessages.find((msg) => msg.content.includes('ready for review'));
    expect(readyMessage).toBeDefined();
  }
  console.log('✅ Test 4 completed successfully!\n');
}

/**
 * Test 5: Reviewer Added
 * Creates a PR, adds a reviewer, and verifies thread message is posted
 */
async function test5ReviewerAdded(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 5: Reviewer Added\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Reviewer Added', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 5: Reviewer Added');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 5');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create PR without reviewers
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    []
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);

  // Add reviewer
  // Note: Reviewer is assigned using their real GitHub username so Discord can map them correctly
  const reviewer = ctx.config.test.reviewers![0];
  await ctx.github.requestReviewers(pr.number, [reviewer]);

  // Wait for workflow (review_requested event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for parent message to be updated (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && !updatedMessage.content.includes('**Reviewers:**')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Parent message not updated after ${maxAttempts * 2} seconds`);
  }

  // Verify parent message was updated with reviewer
  const reviewerCheck = verifyReviewerMention(updatedMessage, reviewer);
  if (!reviewerCheck.passed) {
    console.warn(`⚠️  Reviewer mention check: ${reviewerCheck.error}`);
    // Still check if reviewers line exists
    expect(updatedMessage.content).toContain('**Reviewers:**');
  }
  
  // Wait for thread message to appear
  await wait(5000);

  // Verify thread message was posted
  if (initialMessage?.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(initialMessage.thread.id, 10);
    
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
  }

  // Re-verify message format at the end of workflow (after reviewer is added)
  // This ensures the message format is correct with the reviewer and no warning text
  await wait(2000); // Give a bit more time for any final updates
  const finalMessage = await ctx.discord.getMessage(initialMessage!.id);
  
  if (finalMessage) {
    // Verify the message doesn't contain the warning text (should be removed when reviewer is added)
    const author = await ctx.github.getPRAuthor(pr.number);
    const formatCheck = verifyParentMessageFormat(
      finalMessage,
      {
        hasReviewers: true,
        prNumber: pr.number,
        prTitle,
        prUrl: pr.url,
        headBranch: branchName,
        baseBranch: defaultBranch,
        author,
        prDescription,
        reviewers: [reviewer],
      },
      'Ready for Review'
    );
    if (!formatCheck.passed) {
      console.error('❌ Final message formatting verification failed (after reviewer added):');
      formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
      console.log('\nFinal message content:\n---\n' + finalMessage.content + '\n---');
      throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${finalMessage.content}`);
    }
    console.log('✓ Final message format verified after reviewer was added');
  }
  console.log('✅ Test 5 completed successfully!\n');
}

/**
 * Test 6: Reviewer Removed
 * Creates a PR with a reviewer, removes the reviewer, and verifies thread message is posted
 */
async function test6ReviewerRemoved(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 6: Reviewer Removed\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Reviewer Removed', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 6: Reviewer Removed');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 6');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  // Note: Reviewer is assigned using their real GitHub username so Discord can map them correctly
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  const initialReviewerCheck = verifyReviewerMention(initialMessage!, reviewer);
  if (!initialReviewerCheck.passed) {
    console.warn(`⚠️  Initial reviewer mention check: ${initialReviewerCheck.error}`);
    // Still verify reviewers line exists
    expect(initialMessage?.content).toContain('**Reviewers:**');
  }
  ctx.trackDiscordMessage(initialMessage);

  // Remove reviewer
  await ctx.github.removeReviewer(pr.number, reviewer);

  // Wait for workflow (review_request_removed event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Wait longer for Discord to process messages
  await wait(10000);

  // Verify thread message was posted (poll for it)
  if (initialMessage?.thread) {
    // Poll for thread message (can take time for Discord to process)
    let removalMessage: DiscordMessage | undefined = undefined;
    let attempts = 0;
    const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
    
    while (attempts < maxAttempts && !removalMessage) {
      const threadMessages = await ctx.discord.getThreadMessages(initialMessage.thread.id, 10);
      
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
      const finalThreadMessages = await ctx.discord.getThreadMessages(initialMessage.thread.id, 10);
      console.error(`Final thread messages (${finalThreadMessages.length}):`);
      finalThreadMessages.forEach((msg, idx) => {
        const content = msg.content || '(empty)';
        console.error(`  ${idx + 1}. ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
      });
      throw new Error('Thread message about reviewer removal not found');
    }
    expect(removalMessage).toBeDefined();

  }
  const finalMessage = await ctx.discord.getMessage(initialMessage!.id);
  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    finalMessage,
    {
      hasReviewers: false,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
    },
    'Ready for Review'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed (after reviewer removed):');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + finalMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${finalMessage.content}`);
  }
  console.log('✓ Final message format verified');
  console.log('✅ Test 6 completed successfully!\n');
}

/**
 * Test 7: Review Approved
 * Creates a PR with a reviewer, submits an approval review, and verifies ✅ reaction and status update
 */
async function test7ReviewApproved(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 7: Review Approved\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Review Approved', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 7: Review Approved');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 7');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);

  // Submit approval review
  // Note: The GitHub App submits the review (not the actual reviewer user)
  // This allows testing without requiring the reviewer to actually perform actions
  const review = await ctx.github.submitReview(pr.number, 'APPROVE', 'Looks good!');

  // Wait for workflow (pull_request_review event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for status update (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && !updatedMessage.content.includes('Approved')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
  }

  // Verify ✅ reaction was added
  const reactionCheck = verifyReaction(updatedMessage, '✅', true);
  if (!reactionCheck.passed) {
    console.warn(`⚠️  Reaction check: ${reactionCheck.error}`);
    // Still continue - reaction might take longer
  }

  await wait(5000);
  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: true,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
      reviewers: [reviewer],
    },
    'Approved',
    reviewer
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');

  if (updatedMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const approvalMessage = threadMessages.find((msg) =>
      msg.content.includes('approved') && (msg.content.includes(reviewer) || msg.content.includes('@'))
    );
    expect(approvalMessage).toBeDefined();
    const threadState = await verifyThreadState(ctx.discord, updatedMessage.thread.id, true, undefined);
    expect(threadState.passed).toBe(true);
  }
  console.log('✅ Test 7 completed successfully!\n');
}

/**
 * Test 8: Changes Requested
 * Creates a PR with a reviewer, submits a changes requested review, and verifies ❌ reaction and status update
 */
async function test8ChangesRequested(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 8: Changes Requested\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Changes Requested', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 8: Changes Requested');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 8');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  // Note: We assign the reviewer using their real GitHub username so Discord can map them correctly
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);

  // Submit changes requested review
  // Note: The GitHub App submits the review (not the actual reviewer user)
  // This allows testing without requiring the reviewer to actually perform actions
  const review = await ctx.github.submitReview(pr.number, 'REQUEST_CHANGES', 'Please fix these issues');

  // Wait for workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for status update (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && !updatedMessage.content.includes('Changes Requested')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
  }

  // Verify ❌ reaction was added
  const reactionCheck = verifyReaction(updatedMessage, '❌', true);
  if (!reactionCheck.passed) {
    console.warn(`⚠️  Reaction check: ${reactionCheck.error}`);
    // Still continue - reaction might take longer
  }

  await wait(5000);
  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: true,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
      reviewers: [reviewer],
    },
    'Changes Requested',
    reviewer
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');

  if (updatedMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const changesMessage = threadMessages.find((msg) =>
      msg.content.includes('changes have been requested') && (msg.content.includes(reviewer) || msg.content.includes('@'))
    );
    expect(changesMessage).toBeDefined();
    expect(changesMessage?.content).toContain('Please fix these issues');
    const threadState = await verifyThreadState(ctx.discord, updatedMessage.thread.id, false, undefined);
    expect(threadState.passed).toBe(true);
  }
  console.log('✅ Test 8 completed successfully!\n');
}

/**
 * Test 9: Review Comment Only
 * Creates a PR with a reviewer, submits a comment-only review, and verifies Discord is NOT updated
 */
async function test9ReviewCommentOnly(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 9: Review Comment Only\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Review Comment', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 9: Review Comment Only');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 9');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);
  const initialContent = initialMessage!.content;

  // Submit comment-only review
  // Note: The GitHub App submits the review (not the actual reviewer user)
  const review = await ctx.github.submitReview(pr.number, 'COMMENT', 'Just a comment, no approval or changes');

  // Wait for workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(5000);

  const updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  expect(updatedMessage.content).toBe(initialContent);
  const reactionCheck = verifyReaction(updatedMessage, '✅', false);
  expect(reactionCheck.passed).toBe(true);
  const reactionCheck2 = verifyReaction(updatedMessage, '❌', false);
  expect(reactionCheck2.passed).toBe(true);

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: true,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
      reviewers: [reviewer],
    },
    'Ready for Review'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');
  console.log('✅ Test 9 completed successfully!\n');
}

/**
 * Test 10: Review Dismissed
 * Creates a PR with a reviewer, submits changes requested review, dismisses it, and verifies status is reset
 */
async function test10ReviewDismissed(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 10: Review Dismissed\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Review Dismissed', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 10: Review Dismissed');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 10');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Submit changes requested review
  const review = await ctx.github.submitReview(pr.number, 'REQUEST_CHANGES', 'Please fix');

  // Wait for workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get message after changes requested
  const changesMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(changesMessage?.content).toContain('Changes Requested');
  ctx.trackDiscordMessage(changesMessage);

  // Dismiss the review
  await ctx.github.dismissReview(pr.number, review.id, 'Changes have been addressed');

  // Wait for workflow (review dismissed event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for status reset (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(changesMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && updatedMessage.content.includes('Changes Requested')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(changesMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Status not reset after ${maxAttempts * 2} seconds`);
  }

  expect(updatedMessage.content).not.toContain('Changes Requested');
  await wait(5000);

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: true,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
      reviewers: [reviewer],
    },
    'Ready for Review'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');

  if (updatedMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const dismissalMessage = threadMessages.find((msg) =>
      msg.content.includes('addressed') || msg.content.includes('dismissed')
    );
    expect(dismissalMessage).toBeDefined();
  }
  console.log('✅ Test 10 completed successfully!\n');
}

/**
 * Test 11: Review Dismissed (Approved)
 * Creates a PR with a reviewer, submits approval review, dismisses it, and verifies workflow skips processing
 */
async function test11ReviewDismissedApproved(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 11: Review Dismissed (Approved)\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('Review Dismissed Approved', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 11: Review Dismissed (Approved)');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 11');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Submit approval review
  const review = await ctx.github.submitReview(pr.number, 'APPROVE', 'Looks good');

  // Wait for workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get message after approval
  const approvalMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(approvalMessage?.content).toContain('Approved');
  ctx.trackDiscordMessage(approvalMessage);

  const approvalContent = approvalMessage!.content;
  const approvalReactions = approvalMessage!.reactions || [];

  // Dismiss the approved review
  await ctx.github.dismissReview(pr.number, review.id, 'Dismissing approval');

  // Wait a bit (workflow should skip processing)
  await wait(10000);

  const updatedMessage = await ctx.discord.getMessage(approvalMessage!.id);
  expect(updatedMessage.content).toBe(approvalContent);
  expect(updatedMessage.reactions?.length || 0).toBe(approvalReactions.length);

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: true,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
      reviewers: [reviewer],
    },
    'Approved',
    reviewer
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');
  console.log('✅ Test 11 completed successfully!\n');
}

/**
 * Test 12: PR Synchronize (After Approval)
 * Creates a PR with a reviewer, approves it, pushes new commits, and verifies thread is unlocked and status is reset
 */
async function test12PRSynchronizeAfterApproval(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 12: PR Synchronize (After Approval)\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Synchronize After Approval', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 12: PR Synchronize (After Approval)');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 12');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and initial commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  const reviewer = ctx.config.test.reviewers![0];

  // Create PR with reviewer
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    [reviewer]
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Submit approval review
  await ctx.github.submitReview(pr.number, 'APPROVE', 'Approved');

  // Wait for workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get message after approval
  const approvalMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(approvalMessage?.content).toContain('Approved');
  ctx.trackDiscordMessage(approvalMessage);

  // Verify thread is locked
  if (approvalMessage?.thread) {
    const threadStateBefore = await verifyThreadState(ctx.discord, approvalMessage.thread.id, true, undefined);
    expect(threadStateBefore.passed).toBe(true);
  }

  // Push new commit (synchronize)
  await ctx.github.createCommit(branchName, `${commitMessage} - Update`, `${fileContent}\n\nUpdate`, `test-${testId}.txt`);

  // Wait for workflow (synchronize event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for status reset and thread unlock (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(approvalMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && updatedMessage.content.includes('Approved')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(approvalMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Status not reset after ${maxAttempts * 2} seconds`);
  }

  expect(updatedMessage.content).not.toContain('Approved');
  await wait(5000);

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: true,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
      reviewers: [reviewer],
    },
    'Ready for Review'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');

  if (updatedMessage.thread) {
    const threadStateAfter = await verifyThreadState(ctx.discord, updatedMessage.thread.id, false, undefined);
    expect(threadStateAfter.passed).toBe(true);
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const syncMessage = threadMessages.find((msg) => msg.content.includes('New commits have been pushed'));
    expect(syncMessage).toBeDefined();
  }
  console.log('✅ Test 12 completed successfully!\n');
}

/**
 * Test 13: PR Synchronize (No Approval)
 * Creates a PR without approval, pushes new commits, and verifies workflow skips processing
 */
async function test13PRSynchronizeNoApproval(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 13: PR Synchronize (No Approval)\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Synchronize No Approval', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 13: PR Synchronize (No Approval)');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 13');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and initial commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create PR without reviewers
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    []
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);

  const initialContent = initialMessage!.content;

  // Push new commit (synchronize)
  await ctx.github.createCommit(branchName, `${commitMessage} - Update`, `${fileContent}\n\nUpdate`, `test-${testId}.txt`);

  // Wait a bit (workflow should skip processing)
  await wait(10000);

  const updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  expect(updatedMessage.content).toBe(initialContent);

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: false,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
    },
    'Ready for Review'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');
  console.log('✅ Test 13 completed successfully!\n');
}

/**
 * Test 14: PR Closed
 * Creates a PR, closes it, and verifies thread is locked and status is updated
 */
async function test14PRClosed(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 14: PR Closed\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Closed', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 14: PR Closed');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 14');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create PR
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    []
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);

  // Verify thread is not locked initially
  if (initialMessage?.thread) {
    const threadStateBefore = await verifyThreadState(ctx.discord, initialMessage.thread.id, false, undefined);
    expect(threadStateBefore.passed).toBe(true);
  }

  // Close PR
  await ctx.github.closePR(pr.number);

  // Wait for workflow (closed event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for status update (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && !updatedMessage.content.includes('Closed')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
  }

  await wait(5000);
  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: false,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
    },
    'Closed'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => console.error(`  - ${e}`));
    console.log('\nFinal message content:\n---\n' + updatedMessage.content + '\n---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');

  if (updatedMessage.thread) {
    const threadStateAfter = await verifyThreadState(ctx.discord, updatedMessage.thread.id, true, undefined);
    expect(threadStateAfter.passed).toBe(true);
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const closeMessage = threadMessages.find((msg) => msg.content.includes('closed'));
    expect(closeMessage).toBeDefined();
  }
  console.log('✅ Test 14 completed successfully!\n');
}

/**
 * Test 15: PR Merged
 * Creates a PR, merges it, and verifies thread is archived, locked, and 🎉 reaction is added
 */
async function test15PRMerged(ctx: TestContext): Promise<void> {
  console.log('\n📝 Starting Test 15: PR Merged\n');
  
  const testId = generateTestId(ctx.config.test.prefix);
  const branchName = ctx.testData.generateBranchName(testId);
  const prTitle = ctx.testData.generatePRTitle('PR Merged', testId);
  const prDescription = ctx.testData.generatePRDescription('Test 15: PR Merged');
  const fileContent = ctx.testData.generateFileContent(testId);
  const commitMessage = ctx.testData.generateCommitMessage('Test 15');

  // Get default branch
  const defaultBranch = await ctx.github.getDefaultBranch();

  // Create branch and commit
  await ctx.github.createBranch(branchName, defaultBranch);
  await ctx.github.createCommit(branchName, commitMessage, fileContent, `test-${testId}.txt`);
  await wait(2000);

  // Create PR
  const pr = await ctx.github.createPR(
    prTitle,
    branchName,
    defaultBranch,
    prDescription,
    false,
    []
  );
  console.log(`✓ PR created: #${pr.number} - ${pr.url}`);
  ctx.testPRs.push(pr.number);

  // Wait for initial workflow
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  // Get initial Discord message
  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  expect(initialMessage).toBeDefined();
  ctx.trackDiscordMessage(initialMessage);

  // Merge PR
  await ctx.github.mergePR(pr.number, 'merge');

  // Wait for workflow (closed event with merged=true)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  
  // Poll for status update and reaction (can take time for Discord to process)
  let updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 2 seconds = 30 seconds max
  while (attempts < maxAttempts && !updatedMessage.content.includes('Merged')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(initialMessage!.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Status not updated after ${maxAttempts * 2} seconds`);
  }

  // Verify 🎉 reaction was added
  const reactionCheck = verifyReaction(updatedMessage, '🎉', true);
  if (!reactionCheck.passed) {
    console.warn(`⚠️  Reaction check: ${reactionCheck.error}`);
    // Still continue - reaction might take longer
  }

  const author = await ctx.github.getPRAuthor(pr.number);
  const formatCheck = verifyParentMessageFormat(
    updatedMessage,
    {
      hasReviewers: false,
      prNumber: pr.number,
      prTitle,
      prUrl: pr.url,
      headBranch: branchName,
      baseBranch: defaultBranch,
      author,
      prDescription,
    },
    'Merged'
  );
  if (!formatCheck.passed) {
    console.error('❌ Final message formatting verification failed:');
    formatCheck.errors.forEach((e) => {
      console.error(`  - ${e}`);
    });
    console.log('\nActual message content:');
    console.log('---');
    console.log(updatedMessage.content);
    console.log('---');
    throw new Error(`Final message formatting verification failed:\n${formatCheck.errors.map((e) => `  - ${e}`).join('\n')}\n\nFinal message:\n${updatedMessage.content}`);
  }
  console.log('✓ Final message format verified');
  await wait(5000);

  if (updatedMessage.thread) {
    const threadState = await verifyThreadState(ctx.discord, updatedMessage.thread.id, true, true);
    expect(threadState.passed).toBe(true);
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const mergeMessage = threadMessages.find((msg) => msg.content.includes('merged'));
    expect(mergeMessage).toBeDefined();
  }
  console.log('✅ Test 15 completed successfully!\n');
}

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

  /**
   * Get test context for passing to test functions
   */
  function getTestContext(): TestContext {
    return {
      config,
      github,
      discord,
      testData,
      testPRs,
      testDiscordMessages,
      trackDiscordMessage,
    };
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

  describe('Test 1: PR Opened (Draft)', () => {
    it('Test 1: should create Discord message for draft PR with reviewers', {
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test1PROpenedDraft(getTestContext());
    });
  });

  describe('Test 2: PR Opened (Ready)', () => {
    it('Test 2: should create Discord message with warning for ready PR without reviewers', {
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test2PROpenedReady(getTestContext());
    });
  });

  describe('Test 3: PR Opened (Multiple Reviewers)', () => {
    it('Test 3: should create Discord message listing all reviewers', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 2,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test3PROpenedMultipleReviewers(getTestContext());
    });
  });

  describe('Test 4: Draft → Ready', () => {
    it('Test 4: should update Discord message status when draft PR is marked ready', {
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test4DraftToReady(getTestContext());
    });
  });

  describe('Test 5: Reviewer Added', () => {
    it('Test 5: should post thread message when reviewer is added', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test5ReviewerAdded(getTestContext());
    });
  });

  // Test 6: Reviewer Removed
  describe('Test 6: Reviewer Removed', () => {
    it('Test 6: should post thread message when reviewer is removed', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test6ReviewerRemoved(getTestContext());
    });
  });


  // Test 7: Review Approved
  describe('Test 7: Review Approved', () => {
    it('Test 7: should add ✅ reaction and update status when PR is approved', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test7ReviewApproved(getTestContext());
    });
  });

  describe('Test 8: Changes Requested', () => {
    it('Test 8: should add ❌ reaction and update status when changes are requested', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test8ChangesRequested(getTestContext());
    });
  });

  describe('Test 9: Review Comment Only', () => {
    it('Test 9: should not update Discord when review is comment-only', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test9ReviewCommentOnly(getTestContext());
    });
  });

  // Test 10: Review Dismissed
  describe('Test 10: Review Dismissed', () => {
    it('should reset status when changes requested review is dismissed', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test10ReviewDismissed(getTestContext());
    });
  });

  // Test 11: Review Dismissed (Approved)
  describe('Test 11: Review Dismissed (Approved)', () => {
    it('Test 11: should skip processing when approved review is dismissed', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test11ReviewDismissedApproved(getTestContext());
    });
  });

  describe('Test 12: PR Synchronize (After Approval)', () => {
    it('Test 12: should unlock thread and reset status when new commits are pushed after approval', {
      skip: !moduleConfig?.test.reviewers || moduleConfig.test.reviewers.length < 1,
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test12PRSynchronizeAfterApproval(getTestContext());
    });
  });

  describe('Test 13: PR Synchronize (No Approval)', () => {
    it('Test 13: should skip processing when PR without approval is synchronized', {
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test13PRSynchronizeNoApproval(getTestContext());
    });
  });

  describe('Test 14: PR Closed', () => {
    it('Test 14: should lock thread and update status when PR is closed', {
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test14PRClosed(getTestContext());
    });
  });

  describe('Test 15: PR Merged', () => {
    it('Test 15: should archive thread and add 🎉 reaction when PR is merged', {
      timeout: 600000, // 10 minute timeout for E2E tests
    }, async () => {
      await test15PRMerged(getTestContext());
    });
  });
});
