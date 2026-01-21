import { GitHubClient } from './github-client';
import { DiscordClient } from './discord-client';

/**
 * Clean up a PR and its associated branch
 */
export async function cleanupPR(
  github: GitHubClient,
  prNumber: number,
  deleteBranch: boolean = true
): Promise<void> {
  try {
    // Get PR details to find the branch
    const pr = await github.getPR(prNumber);
    
    // Close the PR if it's still open
    if (pr.state === 'open') {
      try {
        await github.closePR(prNumber);
      } catch (error) {
        // PR might already be closed or merged
        console.warn(`Failed to close PR #${prNumber}:`, error);
      }
    }

    // Delete the branch if requested and PR is closed/merged
    if (deleteBranch && (pr.state === 'closed' || pr.merged)) {
      try {
        await github.deleteBranch(pr.head.ref);
      } catch (error) {
        // Branch might already be deleted or is default branch
        console.warn(`Failed to delete branch ${pr.head.ref}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to cleanup PR #${prNumber}:`, error);
    // Don't throw - cleanup failures shouldn't fail tests
  }
}

/**
 * Clean up multiple PRs
 */
export async function cleanupPRs(
  github: GitHubClient,
  prNumbers: number[],
  deleteBranches: boolean = true
): Promise<void> {
  for (const prNumber of prNumbers) {
    await cleanupPR(github, prNumber, deleteBranches);
  }
}

/**
 * Clean up Discord messages (optional, requires bot permissions)
 */
export async function cleanupDiscordMessage(
  discord: DiscordClient,
  messageId: string
): Promise<void> {
  try {
    await discord.deleteMessage(messageId);
  } catch (error) {
    // Bot might not have permission or message already deleted
    console.warn(`Failed to delete Discord message ${messageId}:`, error);
  }
}

/**
 * Clean up Discord threads (optional, requires bot permissions)
 */
export async function cleanupDiscordThread(
  discord: DiscordClient,
  threadId: string
): Promise<void> {
  try {
    await discord.deleteThread(threadId);
  } catch (error) {
    // Bot might not have permission or thread already deleted
    console.warn(`Failed to delete Discord thread ${threadId}:`, error);
  }
}

/**
 * Clean up Discord message and thread together
 */
export async function cleanupDiscordMessageAndThread(
  discord: DiscordClient,
  messageId: string,
  threadId?: string
): Promise<void> {
  // Delete thread first (if it exists)
  // Deleting a thread will also delete its starter message in some cases
  if (threadId) {
    try {
      await cleanupDiscordThread(discord, threadId);
    } catch (error) {
      // Thread might already be deleted or we don't have permission
      // Continue to try deleting the message
    }
  }

  // Also try to delete the message explicitly
  // (in case deleting the thread didn't delete the message, or thread deletion failed)
  try {
    await cleanupDiscordMessage(discord, messageId);
  } catch (error) {
    // Message might already be deleted or we don't have permission
    // That's okay, we've done our best to clean up
  }
}

/**
 * Generate a unique test identifier
 */
export function generateTestId(prefix: string = 'e2e'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate a unique branch name
 */
export function generateBranchName(prefix: string, testId: string): string {
  return `${prefix}-${testId}`;
}
