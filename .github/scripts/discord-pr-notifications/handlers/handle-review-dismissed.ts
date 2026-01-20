import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage } from '../utils/discord';
import { getMetadataFromPR, postMetadataMissingComment } from '../utils/github';
import { replaceStatusLine, mapToDiscord } from '../utils/formatting';

export async function handleReviewDismissed(
  context: HandlerContext,
  core: Core,
  botToken: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const review = context.payload.review;
  if (!review) {
    core.warning('No review found in payload');
    return;
  }

  const prNumber = pr.number;
  const reviewer = review.user.login;
  const reviewState = review.state; // The original state before dismissal

  // Only notify if it was a changes_requested review
  if (reviewState !== 'changes_requested') {
    core.info('Dismissed review was not changes_requested, skipping.');
    return;
  }

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

  // Post in thread to notify the reviewer
  const reviewerMention = mapToDiscord(reviewer, userMapping);
  await sendThreadMessage(
    botToken,
    metadata.thread_id,
    `✅ ${reviewerMention} The requested changes have been addressed. Please review the updates.`
  );

  // Update parent message status to "In Review"
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const updatedContent = replaceStatusLine(messageData.content, ':eyes: Ready for Review');

    await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }
}
