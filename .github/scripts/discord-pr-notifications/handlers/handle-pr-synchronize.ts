import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage, lockThread } from '../utils/discord';
import { getMetadataFromPR, postMetadataMissingComment, requestReviewers } from '../utils/github';
import { mapToDiscord } from '../utils/formatting';

export async function handlePRSynchronize(
  context: HandlerContext,
  core: Core,
  botToken: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const prNumber = pr.number;

  if (!botToken) {
    core.setFailed('DISCORD_BOT_TOKEN secret must be set');
    return;
  }

  const metadata = await getMetadataFromPR(context, prNumber);

  if (!metadata || !metadata.thread_id) {
    core.warning('No Discord thread found for this PR. Skipping.');
    try {
      await postMetadataMissingComment(context, prNumber);
    } catch (e) {
      core.warning(`Failed to comment in PR: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  // Check if PR was previously approved by reading Discord message
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const content = messageData.content;

    // Check if status is "Approved"
    const isApproved = content.includes('**Status**: :white_check_mark: Approved');

    if (isApproved) {
      // Get current reviewers
      const allReviewers = pr.requested_reviewers || [];
      const allReviewerLogins = allReviewers.map((r) => r.login);

      // Unlock thread if it was locked
      try {
        await lockThread(botToken, metadata.thread_id, false);
      } catch (e) {
        core.warning(`Failed to unlock thread: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Update status to "In Review"
      const lines = content.split('\n');
      const newLines = lines.map((line) => {
        if (line.startsWith('**Status**:')) {
          return '**Status**: :eyes: Ready for Review';
        }
        return line;
      });

      const updatedContent = newLines.join('\n');

      await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);

      // Post in thread to notify reviewers
      if (allReviewerLogins.length > 0) {
        const reviewerMentions = allReviewerLogins.map((login) => mapToDiscord(login, userMapping)).join(' ');
        await sendThreadMessage(
          botToken,
          metadata.thread_id,
          `⚠️ New commits have been pushed to this PR. ${reviewerMentions} Please review the updates.`
        );
      } else {
        await sendThreadMessage(
          botToken,
          metadata.thread_id,
          '⚠️ New commits have been pushed to this PR. Please add reviewers if needed.'
        );
      }

      // Re-request reviews
      if (allReviewerLogins.length > 0) {
        try {
          await requestReviewers(context, prNumber, allReviewerLogins);
        } catch (e) {
          core.warning(`Failed to re-request reviews: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    core.warning(`Failed to handle PR synchronize: ${e instanceof Error ? e.message : String(e)}`);
  }
}
