import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage } from '../utils/discord';
import { getMetadataFromPR, postMetadataMissingComment } from '../utils/github';
import { updateReviewersLine, mapToDiscord } from '../utils/formatting';

export async function handleReviewerAdded(
  context: HandlerContext,
  core: Core,
  botToken: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const prNumber = pr.number;
  const prUrl = pr.html_url;

  // Get ALL current reviewers from PR (not just the one that triggered the event)
  const allReviewers = pr.requested_reviewers || [];
  const allReviewerLogins = allReviewers.map((r) => r.login);

  // Get the specific reviewer that triggered this event (for thread notification)
  const requestedReviewer = context.payload.requested_reviewer;
  const reviewerLogin = requestedReviewer ? requestedReviewer.login : null;

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

  // Post in thread for the newly added reviewer(s)
  if (reviewerLogin) {
    const reviewerMention = mapToDiscord(reviewerLogin, userMapping);
    await sendThreadMessage(
      botToken,
      metadata.thread_id,
      `:bellhop: ${reviewerMention} - your review as been requested for [PR #${prNumber}](${prUrl})`
    );
  }

  // Update parent message with ALL current reviewers (handles multiple additions)
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const updatedContent = updateReviewersLine(messageData.content, allReviewerLogins, userMapping);

    await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }
}
