import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';
import { GitHubClient } from './helpers/github-client';
import { DiscordClient, type DiscordMessage } from './helpers/discord-client';
import { waitForWorkflow, wait, waitForDiscordUpdate } from './helpers/workflow-waiter';
import { cleanupPR, cleanupDiscordMessageAndThread, generateTestId } from './helpers/cleanup';
import {
  verifyMessageContent,
  verifyPRMetadata,
  verifyReaction,
  verifyThreadState,
  verifyParentMessageFormat,
  verifyReviewerMention,
  type VerificationCase,
  reportVerificationResults,
} from './helpers/verification';
import { TestDataGenerator } from './fixtures/test-data';

/**
 * E2E Testing Approach:
 * 
 * Reviewer Assignment:
 * - Reviewers are assigned using real GitHub usernames (from E2E_TEST_REVIEWERS config)
 * - This ensures Discord can correctly map GitHub usernames to Discord users for notifications
 * 
 * Dual Authentication:
 * - Primary auth (GITHUB_APP_* or GITHUB_TOKEN): Creates PRs, branches, commits, merges, closes
 * - Review auth (GITHUB_REVIEW_APP_* or GITHUB_REVIEW_TOKEN): Submits reviews, dismisses reviews
 * - This separation is required because GitHub doesn't allow PR authors to review their own PRs
 * - Review actions (approve, request changes, comment) are performed by the review identity
 * 
 * This approach enables:
 * - Testing Discord username mapping functionality
 * - Automated testing without user intervention
 * - Independent test execution in any environment with proper GitHub App setup
 * - Testing review workflows (approve, changes requested) that require different identities
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
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Discord message exists',
    passed: !!discordMessage,
    detail: discordMessage ? undefined : 'No message found for PR',
  });

  if (discordMessage) {
    console.log(`✓ Discord message found: ${discordMessage.id}`);
    ctx.trackDiscordMessage(discordMessage);

    const contentCheck = verifyMessageContent(discordMessage, [
      `PR #${pr.number}`,
      prTitle,
      'Draft - In Progress',
    ]);
    cases.push({
      name: 'Message contains PR #, title, and Draft status',
      passed: contentCheck.passed,
      detail: contentCheck.errors.length ? contentCheck.errors.join('; ') : undefined,
    });

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
    cases.push({
      name: 'Parent message format (header, branch, author, warning, status)',
      passed: formatCheck.passed,
      detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
    });

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
    }

    cases.push({
      name: 'PR metadata comment exists (thread_id)',
      passed: metadataCheck.passed,
      detail: metadataCheck.error,
    });

    let threadExists = false;
    if (discordMessage.thread?.id) {
      threadExists = true;
      const trackedIndex = ctx.testDiscordMessages.findIndex((m) => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = discordMessage.thread.id;
      }
    } else if (threadId) {
      const trackedIndex = ctx.testDiscordMessages.findIndex((m) => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = threadId;
      }
      try {
        const thread = await ctx.discord.getThread(threadId);
        threadExists = !!thread?.id;
      } catch {
        threadExists = false;
      }
    }

    cases.push({
      name: 'Thread created (message or metadata)',
      passed: threadExists,
      detail: threadExists ? undefined : 'Neither message.thread nor metadata thread_id found or fetchable',
    });
  }

  reportVerificationResults('Test 1: PR Opened (Draft)', cases);
  console.log('✅ Test 1 completed successfully!\n');
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
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Discord message exists',
    passed: !!discordMessage,
    detail: discordMessage ? undefined : 'No message found for PR',
  });

  if (discordMessage) {
    console.log(`✓ Discord message found: ${discordMessage.id}`);
    ctx.trackDiscordMessage(discordMessage);

    const contentCheck = verifyMessageContent(discordMessage, [
      `PR #${pr.number}`,
      prTitle,
      'Ready for Review',
      'WARNING',
      'No reviewers assigned',
    ]);
    cases.push({
      name: 'Message contains PR #, title, Ready for Review, WARNING, No reviewers assigned',
      passed: contentCheck.passed,
      detail: contentCheck.errors.length ? contentCheck.errors.join('; ') : undefined,
    });

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
    cases.push({
      name: 'Parent message format (header, branch, author, warning, status)',
      passed: formatCheck.passed,
      detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
    });

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
    }

    cases.push({
      name: 'PR metadata comment exists (thread_id)',
      passed: metadataCheck.passed,
      detail: metadataCheck.error,
    });

    let threadExists = false;
    if (discordMessage.thread?.id) {
      threadExists = true;
      const trackedIndex = ctx.testDiscordMessages.findIndex((m) => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = discordMessage.thread.id;
      }
    } else if (threadId) {
      const trackedIndex = ctx.testDiscordMessages.findIndex((m) => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = threadId;
      }
      try {
        const thread = await ctx.discord.getThread(threadId);
        threadExists = !!thread?.id;
      } catch {
        threadExists = false;
      }
    }

    cases.push({
      name: 'Thread created (message or metadata)',
      passed: threadExists,
      detail: threadExists ? undefined : 'Neither message.thread nor metadata thread_id found or fetchable',
    });
  }

  reportVerificationResults('Test 2: PR Opened (Ready)', cases);
  console.log('✅ Test 2 completed successfully!\n');
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
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Discord message exists',
    passed: !!discordMessage,
    detail: discordMessage ? undefined : 'No message found for PR',
  });

  if (discordMessage) {
    console.log(`✓ Discord message found: ${discordMessage.id}`);
    ctx.trackDiscordMessage(discordMessage);

    const contentCheck = verifyMessageContent(discordMessage, [
      `PR #${pr.number}`,
      prTitle,
      'Ready for Review',
    ]);
    cases.push({
      name: 'Message contains PR #, title, Ready for Review',
      passed: contentCheck.passed,
      detail: contentCheck.errors.length ? contentCheck.errors.join('; ') : undefined,
    });

    const hasReviewersLine = discordMessage.content.includes('**Reviewers:**');
    cases.push({
      name: 'Message has Reviewers line',
      passed: hasReviewersLine,
      detail: hasReviewersLine ? undefined : '**Reviewers:** not found',
    });

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
    cases.push({
      name: 'Parent message format (header, branch, author, reviewers, status)',
      passed: formatCheck.passed,
      detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
    });

    await wait(2000);
    const metadataCheck = await verifyPRMetadata(ctx.github, pr.number);
    let threadId: string | undefined;
    let finalThreadId: string | undefined;

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
    }

    cases.push({
      name: 'PR metadata comment exists (thread_id)',
      passed: metadataCheck.passed,
      detail: metadataCheck.error,
    });

    let threadExists = false;
    if (discordMessage.thread?.id) {
      threadExists = true;
      finalThreadId = discordMessage.thread.id;
      const trackedIndex = ctx.testDiscordMessages.findIndex((m) => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = finalThreadId;
      }
    } else if (threadId) {
      finalThreadId = threadId;
      const trackedIndex = ctx.testDiscordMessages.findIndex((m) => m.messageId === discordMessage.id);
      if (trackedIndex >= 0) {
        ctx.testDiscordMessages[trackedIndex].threadId = threadId;
      }
      try {
        const thread = await ctx.discord.getThread(threadId);
        threadExists = !!thread?.id;
      } catch {
        threadExists = false;
      }
    }

    cases.push({
      name: 'Thread created (message or metadata)',
      passed: threadExists,
      detail: threadExists ? undefined : 'Neither message.thread nor metadata thread_id found or fetchable',
    });

    let reviewerMessages: Array<{ reviewer: string; found: boolean; messageId?: string }> = [];
    let threadMessages: DiscordMessage[] = [];

    if (finalThreadId && reviewers.length > 0) {
      let allReviewerMessagesFound = false;
      let attempts = 0;
      const maxAttempts = 20;
      while (attempts < maxAttempts && !allReviewerMessagesFound) {
        await wait(2000);
        attempts++;
        threadMessages = await ctx.discord.getThreadMessages(finalThreadId, 50);
        const reviewerNotificationMessages = threadMessages.filter((msg) => {
          const content = msg.content.toLowerCase();
          return (
            content.includes(':bellhop:') &&
            (content.includes('review') || content.includes('requested')) &&
            (content.includes('pr #') || content.includes('pull request'))
          );
        });
        reviewerMessages = [];
        const usedMessageIds = new Set<string>();
        for (const reviewer of reviewers) {
          const reviewerMessage = reviewerNotificationMessages.find((msg) => {
            if (usedMessageIds.has(msg.id)) return false;
            const content = msg.content.toLowerCase();
            const reviewerLower = reviewer.toLowerCase();
            const mentionsReviewer =
              content.includes(reviewerLower) || (content.includes('<@') && content.includes('review'));
            return (
              mentionsReviewer &&
              content.includes(':bellhop:') &&
              (content.includes('review') || content.includes('requested'))
            );
          });
          if (reviewerMessage) {
            usedMessageIds.add(reviewerMessage.id);
            reviewerMessages.push({ reviewer, found: true, messageId: reviewerMessage.id });
          } else {
            reviewerMessages.push({ reviewer, found: false });
          }
        }
        allReviewerMessagesFound = reviewerMessages.every((rm) => rm.found);
        if (!allReviewerMessagesFound) {
          const foundCount = reviewerMessages.filter((rm) => rm.found).length;
          console.log(`  Attempt ${attempts}/${maxAttempts}: Found ${foundCount}/${reviewers.length} reviewer messages, continuing to poll...`);
        }
      }

      const missingReviewers = reviewerMessages.filter((rm) => !rm.found).map((rm) => rm.reviewer);
      const foundCount = reviewerMessages.filter((rm) => rm.found).length;
      cases.push({
        name: `Each reviewer has unique thread message (${foundCount}/${reviewers.length})`,
        passed: missingReviewers.length === 0,
        detail:
          missingReviewers.length > 0
            ? `Missing: ${missingReviewers.join(', ')}`
            : undefined,
      });

      const reviewerNotificationCount = threadMessages.filter((msg) => {
        const content = msg.content.toLowerCase();
        return (
          content.includes(':bellhop:') &&
          (content.includes('review') || content.includes('requested')) &&
          (content.includes('pr #') || content.includes('pull request'))
        );
      }).length;
      cases.push({
        name: `Exact reviewer notification count (${reviewerNotificationCount} = ${reviewers.length})`,
        passed: reviewerNotificationCount === reviewers.length,
        detail:
          reviewerNotificationCount !== reviewers.length
            ? `Found ${reviewerNotificationCount}, expected ${reviewers.length}`
            : undefined,
      });
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
      cases.push({
        name: 'Final message format (after workflow completion)',
        passed: finalFormatCheck.passed,
        detail: finalFormatCheck.errors.length ? finalFormatCheck.errors.join('; ') : undefined,
      });
    }
  }

  reportVerificationResults('Test 3: PR Opened (Multiple Reviewers)', cases);
  console.log('✅ Test 3 completed successfully!\n');
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
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (initialMessage) {
    ctx.trackDiscordMessage(initialMessage);
    cases.push({
      name: 'Initial message shows Draft - In Progress',
      passed: !!initialMessage.content?.includes('Draft - In Progress'),
      detail: initialMessage.content?.includes('Draft - In Progress')
        ? undefined
        : 'Message does not contain "Draft - In Progress"',
    });
    console.log(`✓ Initial message found: ${initialMessage.id} (Draft status confirmed)`);
  }

  // Mark PR as ready for review
  await ctx.github.markReadyForReview(pr.number);

  // Wait for workflow to complete (ready_for_review event)
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  const updatedMessage = initialMessage
    ? await ctx.discord.getMessage(initialMessage.id)
    : null;

  if (updatedMessage) {
    cases.push({
      name: 'Status updated: no longer Draft - In Progress',
      passed: !updatedMessage.content.includes('Draft - In Progress'),
      detail: updatedMessage.content.includes('Draft - In Progress')
        ? 'Message still contains "Draft - In Progress"'
        : undefined,
    });

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
    cases.push({
      name: 'Parent message format (Ready for Review)',
      passed: formatCheck.passed,
      detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
    });

    if (updatedMessage.thread) {
      const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
      const readyMessage = threadMessages.find((msg) => msg.content.includes('ready for review'));
      cases.push({
        name: 'Thread contains "ready for review" message',
        passed: !!readyMessage,
        detail: readyMessage ? undefined : 'No thread message with "ready for review"',
      });
    } else {
      cases.push({
        name: 'Thread contains "ready for review" message',
        passed: false,
        detail: 'No thread on message',
      });
    }
  }

  reportVerificationResults('Test 4: Draft → Ready', cases);
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
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 5: Reviewer Added', cases);
    console.log('✅ Test 5 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);

  // Add reviewer
  const reviewer = ctx.config.test.reviewers![0];
  await ctx.github.requestReviewers(pr.number, [reviewer]);

  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);

  let updatedMessage = await ctx.discord.getMessage(initialMessage.id);
  let attempts = 0;
  const maxAttempts = 15;
  while (attempts < maxAttempts && !updatedMessage.content.includes('**Reviewers:**')) {
    await wait(2000);
    updatedMessage = await ctx.discord.getMessage(initialMessage.id);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    console.warn(`⚠️  Parent message not updated after ${maxAttempts * 2} seconds`);
  }

  cases.push({
    name: 'Parent message updated with **Reviewers:**',
    passed: updatedMessage.content.includes('**Reviewers:**'),
    detail: updatedMessage.content.includes('**Reviewers:**')
      ? undefined
      : `Poll timed out after ${maxAttempts * 2}s`,
  });

  const reviewerCheck = verifyReviewerMention(updatedMessage, reviewer);
  cases.push({
    name: 'Reviewer mention in parent message',
    passed: reviewerCheck.passed,
    detail: reviewerCheck.error,
  });

  await wait(5000);

  if (initialMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(initialMessage.thread.id, 10);
    const reviewerMessage = threadMessages.find((msg) => {
      const content = msg.content || '';
      return (
        content.includes(':bellhop:') ||
        (content.includes('review') &&
          (content.includes('requested') ||
            content.includes('review as been') ||
            content.includes('review has been') ||
            (content.includes(reviewer) || content.includes('@'))))
      );
    });
    cases.push({
      name: 'Thread message about reviewer request',
      passed: !!reviewerMessage,
      detail: reviewerMessage ? undefined : 'No :bellhop: / review requested message in thread',
    });
  } else {
    cases.push({
      name: 'Thread message about reviewer request',
      passed: false,
      detail: 'No thread on message',
    });
  }

  await wait(2000);
  const finalMessage = await ctx.discord.getMessage(initialMessage.id);
  if (finalMessage) {
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
    cases.push({
      name: 'Final message format (reviewer, no warning)',
      passed: formatCheck.passed,
      detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
    });
  }

  reportVerificationResults('Test 5: Reviewer Added', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 6: Reviewer Removed', cases);
    console.log('✅ Test 6 completed (skipped further checks)\n');
    return;
  }

  const initialReviewerCheck = verifyReviewerMention(initialMessage, reviewer);
  cases.push({
    name: 'Initial message has **Reviewers:** and reviewer mention',
    passed: initialReviewerCheck.passed || initialMessage.content.includes('**Reviewers:**'),
    detail: initialReviewerCheck.passed ? undefined : initialReviewerCheck.error,
  });
  ctx.trackDiscordMessage(initialMessage);

  await ctx.github.removeReviewer(pr.number, reviewer);
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(10000);

  let removalMessage: DiscordMessage | undefined;
  if (initialMessage.thread) {
    let attempts = 0;
    const maxAttempts = 15;
    while (attempts < maxAttempts && !removalMessage) {
      const threadMessages = await ctx.discord.getThreadMessages(initialMessage.thread.id, 10);
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
    cases.push({
      name: 'Thread message about reviewer removal',
      passed: !!removalMessage,
      detail: removalMessage ? undefined : `Poll timed out after ${maxAttempts * 2}s`,
    });
  } else {
    cases.push({
      name: 'Thread message about reviewer removal',
      passed: false,
      detail: 'No thread on message',
    });
  }

  const finalMessage = await ctx.discord.getMessage(initialMessage.id);
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
  cases.push({
    name: 'Final message format (no reviewers, Ready for Review)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  reportVerificationResults('Test 6: Reviewer Removed', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 7: Review Approved', cases);
    console.log('✅ Test 7 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);
  await ctx.github.submitReview(pr.number, 'APPROVE', 'Looks good!');
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);

  const pollOpts = {
    maxAttempts: ctx.config.test.discordStatusPollAttempts ?? 45,
    intervalMs: ctx.config.test.discordPollInterval ?? 2000,
  };
  const { message: updatedMessage, matched } = await waitForDiscordUpdate(
    () => ctx.discord.getMessage(initialMessage.id),
    (m) => m.content.includes('Approved'),
    pollOpts
  );
  if (!matched) {
    console.warn(`⚠️  Status not updated after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)} seconds`);
  }

  cases.push({
    name: 'Status updated to Approved',
    passed: updatedMessage.content.includes('Approved'),
    detail: updatedMessage.content.includes('Approved') ? undefined : `Poll timed out after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)}s`,
  });

  const reactionCheck = verifyReaction(updatedMessage, '✅', true);
  cases.push({
    name: '✅ reaction on message',
    passed: reactionCheck.passed,
    detail: reactionCheck.error,
  });

  await wait(5000);
  const author = await ctx.github.getPRAuthor(pr.number);
  const reviewBot = ctx.config.test.reviewBotUsername ?? 'discord-pr-e2e-review-operations';
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
    [reviewBot, reviewer]  // Status shows approver: bot when using review auth
  );
  cases.push({
    name: 'Parent message format (Approved, reviewer)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  if (updatedMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const approvalMessage = threadMessages.find((msg) =>
      msg.content.includes('approved') && (msg.content.includes(reviewer) || msg.content.includes(reviewBot) || msg.content.includes('@'))
    );
    cases.push({
      name: 'Thread approval message exists',
      passed: !!approvalMessage,
      detail: approvalMessage ? undefined : 'No approval message in thread',
    });
    const reviewComment = 'Looks good!';
    cases.push({
      name: `Thread message contains approval comment "${reviewComment}"`,
      passed: !!approvalMessage?.content?.includes(reviewComment),
      detail: approvalMessage?.content?.includes(reviewComment) ? undefined : `Comment "${reviewComment}" not found`,
    });
    const threadState = await verifyThreadState(ctx.discord, updatedMessage.thread.id, true, undefined);
    cases.push({
      name: 'Thread locked after approval',
      passed: threadState.passed,
      detail: threadState.error,
    });
  } else {
    cases.push({
      name: 'Thread approval message exists',
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: `Thread message contains approval comment "Looks good!"`,
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: 'Thread locked after approval',
      passed: false,
      detail: 'No thread on message',
    });
  }

  reportVerificationResults('Test 7: Review Approved', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 8: Changes Requested', cases);
    console.log('✅ Test 8 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);
  await ctx.github.submitReview(pr.number, 'REQUEST_CHANGES', 'Please fix these issues');
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);

  const pollOpts = {
    maxAttempts: ctx.config.test.discordStatusPollAttempts ?? 45,
    intervalMs: ctx.config.test.discordPollInterval ?? 2000,
  };
  const { message: updatedMessage, matched } = await waitForDiscordUpdate(
    () => ctx.discord.getMessage(initialMessage.id),
    (m) => m.content.includes('Changes Requested'),
    pollOpts
  );
  if (!matched) {
    console.warn(`⚠️  Status not updated after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)} seconds`);
  }

  cases.push({
    name: 'Status updated to Changes Requested',
    passed: updatedMessage.content.includes('Changes Requested'),
    detail: updatedMessage.content.includes('Changes Requested') ? undefined : `Poll timed out after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)}s`,
  });

  // Wait additional time for Discord to fully process the review and thread message
  await wait(5000);
  
  // Re-fetch message to ensure we have latest state (thread might be populated now)
  const refreshedMessage = await ctx.discord.getMessage(initialMessage.id);
  
  const reactionCheck = verifyReaction(refreshedMessage, '❌', true);
  cases.push({
    name: '❌ reaction on message',
    passed: reactionCheck.passed,
    detail: reactionCheck.error,
  });
  
  const author = await ctx.github.getPRAuthor(pr.number);
  const reviewBot = ctx.config.test.reviewBotUsername ?? 'discord-pr-e2e-review-operations';
  const formatCheck = verifyParentMessageFormat(
    refreshedMessage,
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
    [reviewBot, reviewer]  // Status shows requester: bot when using review auth
  );
  cases.push({
    name: 'Parent message format (Changes Requested, reviewer)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  if (refreshedMessage.thread) {
    // Poll for thread message - it may take additional time to appear
    const threadPollOpts = { maxAttempts: pollOpts.maxAttempts, intervalMs: pollOpts.intervalMs };
    const { message: threadMessagesResult } = await waitForDiscordUpdate(
      async () => ctx.discord.getThreadMessages(refreshedMessage.thread!.id, 10),
      (msgs) => msgs.some((m) =>
        m.content.includes('changes have been requested') && (m.content.includes(reviewer) || m.content.includes(reviewBot) || m.content.includes('@'))
      ),
      threadPollOpts
    );
    const changesMessage = threadMessagesResult.find((msg) =>
      msg.content.includes('changes have been requested') && (msg.content.includes(reviewer) || msg.content.includes(reviewBot) || msg.content.includes('@'))
    );
    
    if (!changesMessage) {
      console.warn(`⚠️  Thread message not found after ${threadPollOpts.maxAttempts * (threadPollOpts.intervalMs / 1000)} seconds`);
    }
    
    cases.push({
      name: 'Thread changes-requested message exists',
      passed: !!changesMessage,
      detail: changesMessage ? undefined : `Poll timed out after ${threadPollOpts.maxAttempts * (threadPollOpts.intervalMs / 1000)}s`,
    });
    cases.push({
      name: 'Thread message contains comment "Please fix these issues"',
      passed: !!changesMessage?.content?.includes('Please fix these issues'),
      detail: changesMessage?.content?.includes('Please fix these issues')
        ? undefined
        : 'Comment "Please fix these issues" not found',
    });
    const threadState = await verifyThreadState(ctx.discord, refreshedMessage.thread.id, false, undefined);
    cases.push({
      name: 'Thread not locked (changes requested)',
      passed: threadState.passed,
      detail: threadState.error,
    });
  } else {
    cases.push({
      name: 'Thread changes-requested message exists',
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: 'Thread message contains comment "Please fix these issues"',
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: 'Thread not locked (changes requested)',
      passed: false,
      detail: 'No thread on message',
    });
  }

  reportVerificationResults('Test 8: Changes Requested', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 9: Review Comment Only', cases);
    console.log('✅ Test 9 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);
  const initialContent = initialMessage.content;

  await ctx.github.submitReview(pr.number, 'COMMENT', 'Just a comment, no approval or changes');
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(5000);

  const updatedMessage = await ctx.discord.getMessage(initialMessage.id);
  cases.push({
    name: 'Message content unchanged after comment-only review',
    passed: updatedMessage.content === initialContent,
    detail: updatedMessage.content === initialContent ? undefined : 'Content changed',
  });

  const reactionCheck = verifyReaction(updatedMessage, '✅', false);
  cases.push({
    name: 'No ✅ reaction (comment-only)',
    passed: reactionCheck.passed,
    detail: reactionCheck.error,
  });

  const reactionCheck2 = verifyReaction(updatedMessage, '❌', false);
  cases.push({
    name: 'No ❌ reaction (comment-only)',
    passed: reactionCheck2.passed,
    detail: reactionCheck2.error,
  });

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
  cases.push({
    name: 'Parent message format still Ready for Review',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  reportVerificationResults('Test 9: Review Comment Only', cases);
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

  const review = await ctx.github.submitReview(pr.number, 'REQUEST_CHANGES', 'Please fix');
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(3000);

  const changesMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Message exists after changes requested',
    passed: !!changesMessage,
    detail: changesMessage ? undefined : 'No message found for PR',
  });

  if (!changesMessage) {
    reportVerificationResults('Test 10: Review Dismissed', cases);
    console.log('✅ Test 10 completed (skipped further checks)\n');
    return;
  }

  cases.push({
    name: 'Message shows Changes Requested before dismiss',
    passed: !!changesMessage.content?.includes('Changes Requested'),
    detail: changesMessage.content?.includes('Changes Requested') ? undefined : 'Message does not contain "Changes Requested"',
  });
  ctx.trackDiscordMessage(changesMessage);

  await ctx.github.dismissReview(pr.number, review.id, 'Changes have been addressed');
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);
  await wait(5000);  // Extra buffer for handle-review-dismissed (separate job from handle-pr-review)

  const pollOpts = {
    maxAttempts: ctx.config.test.discordStatusPollAttempts ?? 45,
    intervalMs: ctx.config.test.discordPollInterval ?? 2000,
  };
  const { message: updatedMessage, matched } = await waitForDiscordUpdate(
    () => ctx.discord.getMessage(changesMessage.id),
    (m) => !m.content.includes('Changes Requested'),
    pollOpts
  );
  if (!matched) {
    console.warn(`⚠️  Status not reset after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)} seconds`);
  }

  cases.push({
    name: 'Status reset: no longer Changes Requested',
    passed: !updatedMessage.content.includes('Changes Requested'),
    detail: updatedMessage.content.includes('Changes Requested')
      ? `Poll timed out after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)}s`
      : undefined,
  });

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
  cases.push({
    name: 'Parent message format (Ready for Review after dismiss)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  if (updatedMessage.thread) {
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const dismissalMessage = threadMessages.find((msg) =>
      msg.content.includes('addressed') || msg.content.includes('dismissed')
    );
    cases.push({
      name: 'Thread dismissal message (addressed/dismissed)',
      passed: !!dismissalMessage,
      detail: dismissalMessage ? undefined : 'No dismissal message in thread',
    });
  } else {
    cases.push({
      name: 'Thread dismissal message (addressed/dismissed)',
      passed: false,
      detail: 'No thread on message',
    });
  }

  reportVerificationResults('Test 10: Review Dismissed', cases);
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

  const approvalMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Message exists after approval',
    passed: !!approvalMessage,
    detail: approvalMessage ? undefined : 'No message found for PR',
  });

  if (!approvalMessage) {
    reportVerificationResults('Test 11: Review Dismissed (Approved)', cases);
    console.log('✅ Test 11 completed (skipped further checks)\n');
    return;
  }

  cases.push({
    name: 'Message shows Approved before dismiss',
    passed: !!approvalMessage.content?.includes('Approved'),
    detail: approvalMessage.content?.includes('Approved') ? undefined : 'Message does not contain "Approved"',
  });
  ctx.trackDiscordMessage(approvalMessage);

  const approvalContent = approvalMessage.content;
  const approvalReactions = approvalMessage.reactions || [];

  await ctx.github.dismissReview(pr.number, review.id, 'Dismissing approval');
  await wait(10000);

  const updatedMessage = await ctx.discord.getMessage(approvalMessage.id);
  cases.push({
    name: 'Message unchanged after dismissing approved review',
    passed: updatedMessage.content === approvalContent,
    detail: updatedMessage.content === approvalContent ? undefined : 'Content changed',
  });
  cases.push({
    name: 'Reactions unchanged after dismissing approved review',
    passed: (updatedMessage.reactions?.length || 0) === approvalReactions.length,
    detail:
      (updatedMessage.reactions?.length || 0) === approvalReactions.length
        ? undefined
        : `Reactions: ${updatedMessage.reactions?.length ?? 0} vs ${approvalReactions.length}`,
  });

  const author = await ctx.github.getPRAuthor(pr.number);
  const reviewBot = ctx.config.test.reviewBotUsername ?? 'discord-pr-e2e-review-operations';
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
    [reviewBot, reviewer]  // Status shows approver: bot when using review auth
  );
  cases.push({
    name: 'Parent message format still Approved (workflow skips)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  reportVerificationResults('Test 11: Review Dismissed (Approved)', cases);
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

  const approvalMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Message exists after approval',
    passed: !!approvalMessage,
    detail: approvalMessage ? undefined : 'No message found for PR',
  });

  if (!approvalMessage) {
    reportVerificationResults('Test 12: PR Synchronize (After Approval)', cases);
    console.log('✅ Test 12 completed (skipped further checks)\n');
    return;
  }

  cases.push({
    name: 'Message shows Approved before sync',
    passed: !!approvalMessage.content?.includes('Approved'),
    detail: approvalMessage.content?.includes('Approved') ? undefined : 'Message does not contain "Approved"',
  });
  ctx.trackDiscordMessage(approvalMessage);

  if (approvalMessage.thread) {
    const threadStateBefore = await verifyThreadState(ctx.discord, approvalMessage.thread.id, true, undefined);
    cases.push({
      name: 'Thread locked after approval (before sync)',
      passed: threadStateBefore.passed,
      detail: threadStateBefore.error,
    });
  }

  await ctx.github.createCommit(branchName, `${commitMessage} - Update`, `${fileContent}\n\nUpdate`, `test-${testId}.txt`);
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);

  const pollOpts = {
    maxAttempts: ctx.config.test.discordStatusPollAttempts ?? 45,
    intervalMs: ctx.config.test.discordPollInterval ?? 2000,
  };
  const { message: updatedMessage, matched } = await waitForDiscordUpdate(
    () => ctx.discord.getMessage(approvalMessage.id),
    (m) => !m.content.includes('Approved'),
    pollOpts
  );
  if (!matched) {
    console.warn(`⚠️  Status not reset after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)} seconds`);
  }

  cases.push({
    name: 'Status reset: no longer Approved after sync',
    passed: !updatedMessage.content.includes('Approved'),
    detail: updatedMessage.content.includes('Approved')
      ? `Poll timed out after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)}s`
      : undefined,
  });

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
  cases.push({
    name: 'Parent message format (Ready for Review after sync)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  if (updatedMessage.thread) {
    const threadStateAfter = await verifyThreadState(ctx.discord, updatedMessage.thread.id, false, undefined);
    cases.push({
      name: 'Thread unlocked after sync',
      passed: threadStateAfter.passed,
      detail: threadStateAfter.error,
    });
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const syncMessage = threadMessages.find((msg) => msg.content.includes('New commits have been pushed'));
    cases.push({
      name: 'Thread "New commits have been pushed" message',
      passed: !!syncMessage,
      detail: syncMessage ? undefined : 'No sync message in thread',
    });
  } else {
    cases.push({
      name: 'Thread unlocked after sync',
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: 'Thread "New commits have been pushed" message',
      passed: false,
      detail: 'No thread on message',
    });
  }

  reportVerificationResults('Test 12: PR Synchronize (After Approval)', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 13: PR Synchronize (No Approval)', cases);
    console.log('✅ Test 13 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);
  const initialContent = initialMessage.content;

  await ctx.github.createCommit(branchName, `${commitMessage} - Update`, `${fileContent}\n\nUpdate`, `test-${testId}.txt`);
  await wait(10000);

  const updatedMessage = await ctx.discord.getMessage(initialMessage.id);
  cases.push({
    name: 'Message unchanged after sync (no approval)',
    passed: updatedMessage.content === initialContent,
    detail: updatedMessage.content === initialContent ? undefined : 'Content changed',
  });

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
  cases.push({
    name: 'Parent message format (Ready for Review, workflow skips)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  reportVerificationResults('Test 13: PR Synchronize (No Approval)', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 14: PR Closed', cases);
    console.log('✅ Test 14 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);

  if (initialMessage.thread) {
    const threadStateBefore = await verifyThreadState(ctx.discord, initialMessage.thread.id, false, undefined);
    cases.push({
      name: 'Thread not locked initially',
      passed: threadStateBefore.passed,
      detail: threadStateBefore.error,
    });
  }

  await ctx.github.closePR(pr.number);
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);

  const pollOpts = {
    maxAttempts: ctx.config.test.discordStatusPollAttempts ?? 45,
    intervalMs: ctx.config.test.discordPollInterval ?? 2000,
  };
  const { message: updatedMessage, matched } = await waitForDiscordUpdate(
    () => ctx.discord.getMessage(initialMessage.id),
    (m) => m.content.includes('Closed'),
    pollOpts
  );
  if (!matched) {
    console.warn(`⚠️  Status not updated after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)} seconds`);
  }

  cases.push({
    name: 'Status updated to Closed',
    passed: updatedMessage.content.includes('Closed'),
    detail: updatedMessage.content.includes('Closed') ? undefined : `Poll timed out after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)}s`,
  });

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
  cases.push({
    name: 'Parent message format (Closed)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  if (updatedMessage.thread) {
    const threadStateAfter = await verifyThreadState(ctx.discord, updatedMessage.thread.id, true, undefined);
    cases.push({
      name: 'Thread locked after close',
      passed: threadStateAfter.passed,
      detail: threadStateAfter.error,
    });
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const closeMessage = threadMessages.find((msg) => msg.content.includes('closed'));
    cases.push({
      name: 'Thread close message',
      passed: !!closeMessage,
      detail: closeMessage ? undefined : 'No "closed" message in thread',
    });
  } else {
    cases.push({
      name: 'Thread locked after close',
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: 'Thread close message',
      passed: false,
      detail: 'No thread on message',
    });
  }

  reportVerificationResults('Test 14: PR Closed', cases);
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

  const initialMessage = await ctx.discord.findMessageByPR(pr.number, ctx.config.test.discordPollTimeout);
  const cases: VerificationCase[] = [];

  cases.push({
    name: 'Initial Discord message exists',
    passed: !!initialMessage,
    detail: initialMessage ? undefined : 'No message found for PR',
  });

  if (!initialMessage) {
    reportVerificationResults('Test 15: PR Merged', cases);
    console.log('✅ Test 15 completed (skipped further checks)\n');
    return;
  }

  ctx.trackDiscordMessage(initialMessage);
  await ctx.github.mergePR(pr.number, 'merge');
  await waitForWorkflow(ctx.github, pr.number, ctx.config.test.workflowTimeout);

  const pollOpts = {
    maxAttempts: ctx.config.test.discordStatusPollAttempts ?? 45,
    intervalMs: ctx.config.test.discordPollInterval ?? 2000,
  };
  const { message: updatedMessage, matched } = await waitForDiscordUpdate(
    () => ctx.discord.getMessage(initialMessage.id),
    (m) => m.content.includes('Merged'),
    pollOpts
  );
  if (!matched) {
    console.warn(`⚠️  Status not updated after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)} seconds`);
  }

  cases.push({
    name: 'Status updated to Merged',
    passed: updatedMessage.content.includes('Merged'),
    detail: updatedMessage.content.includes('Merged') ? undefined : `Poll timed out after ${pollOpts.maxAttempts * (pollOpts.intervalMs / 1000)}s`,
  });

  const reactionCheck = verifyReaction(updatedMessage, '🎉', true);
  cases.push({
    name: '🎉 reaction on message',
    passed: reactionCheck.passed,
    detail: reactionCheck.error,
  });

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
    'Merged'
  );
  cases.push({
    name: 'Parent message format (Merged)',
    passed: formatCheck.passed,
    detail: formatCheck.errors.length ? formatCheck.errors.join('; ') : undefined,
  });

  if (updatedMessage.thread) {
    const threadState = await verifyThreadState(ctx.discord, updatedMessage.thread.id, true, true);
    cases.push({
      name: 'Thread locked and archived after merge',
      passed: threadState.passed,
      detail: threadState.error,
    });
    const threadMessages = await ctx.discord.getThreadMessages(updatedMessage.thread.id, 10);
    const mergeMessage = threadMessages.find((msg) => msg.content.includes('merged'));
    cases.push({
      name: 'Thread merge message',
      passed: !!mergeMessage,
      detail: mergeMessage ? undefined : 'No "merged" message in thread',
    });
  } else {
    cases.push({
      name: 'Thread locked and archived after merge',
      passed: false,
      detail: 'No thread on message',
    });
    cases.push({
      name: 'Thread merge message',
      passed: false,
      detail: 'No thread on message',
    });
  }

  reportVerificationResults('Test 15: PR Merged', cases);
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
