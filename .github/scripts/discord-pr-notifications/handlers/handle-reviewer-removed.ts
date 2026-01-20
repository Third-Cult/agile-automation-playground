import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage, removeThreadMember } from '../utils/discord';
import { getMetadataFromPR, postMetadataMissingComment } from '../utils/github';
import { updateReviewersLine, mapToDiscord } from '../utils/formatting';

export async function handleReviewerRemoved(
  context: HandlerContext,
  core: Core,
  botToken: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const prNumber = pr.number;

  // Get ALL current reviewers from PR (after removal)
  const allReviewers = pr.requested_reviewers || [];
  const allReviewerLogins = allReviewers.map((r) => r.login);

  // Get the specific reviewer that was removed (for thread notification)
  const removedReviewer = context.payload.requested_reviewer;
  const removedReviewerLogin = removedReviewer ? removedReviewer.login : null;

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

  // Post in thread for the removed reviewer
  if (removedReviewerLogin) {
    const removedReviewerMention = mapToDiscord(removedReviewerLogin, userMapping);
    await sendThreadMessage(
      botToken,
      metadata.thread_id,
      `👋 ${removedReviewerMention} has been removed as a reviewer from this PR.`
    );

    // Remove reviewer from thread
    if (userMapping[removedReviewerLogin]) {
      const discordUserId = userMapping[removedReviewerLogin];
      try {
        await removeThreadMember(botToken, metadata.thread_id, discordUserId);
        core.info(`Removed ${removedReviewerLogin} from Discord thread`);
      } catch (e) {
        // User not in thread or other error - that's okay
        if (e instanceof Error && !e.message.includes('404')) {
          core.warning(`Error removing ${removedReviewerLogin} from thread: ${e.message}`);
        }
      }
    }
  }

  // Update parent message with ALL current reviewers (after removal)
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const updatedContent = updateReviewersLine(messageData.content, allReviewerLogins, userMapping);

    await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }
}
