import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage, lockThread } from '../utils/discord';
import { getMetadataFromPR, getPRComments, postMetadataMissingComment } from '../utils/github';
import { replaceStatusLine, mapToDiscord } from '../utils/formatting';

export async function handlePRClosed(
  context: HandlerContext,
  core: Core,
  botToken: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const prNumber = pr.number;
  const prUrl = pr.html_url;
  const closer = pr.user.login; // The person who closed it

  // Try to get the closing comment from the PR
  let closeComment = '';
  try {
    const issueComments = await getPRComments(context, prNumber);
    // Get the most recent comment that might be the closing comment
    // Note: GitHub doesn't always provide a specific "closing comment"
    // This is a best-effort approach
    if (issueComments.length > 0) {
      const lastComment = issueComments[issueComments.length - 1];
      // Only use if it's recent (within last minute) and from the closer
      const commentTime = new Date(lastComment.created_at);
      const now = new Date();
      if (now.getTime() - commentTime.getTime() < 60000 && lastComment.user.login === closer) {
        closeComment = lastComment.body || '';
      }
    }
  } catch (e) {
    core.warning(`Could not fetch closing comment: ${e instanceof Error ? e.message : String(e)}`);
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

  // Post in thread
  const closerMention = mapToDiscord(closer, userMapping);
  let closeMessage = `:closed_book: [PR #${prNumber}](${prUrl}) has been closed by ${closerMention}\n`;
  if (closeComment && closeComment.trim() !== '') {
    closeMessage += `> ${closeComment.replace(/\n/g, '\n> ')}\n`;
  }

  await sendThreadMessage(botToken, metadata.thread_id, closeMessage);

  // Lock the thread
  try {
    await lockThread(botToken, metadata.thread_id, true);
  } catch (e) {
    core.warning(`Failed to lock thread: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Update parent message status
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const updatedContent = replaceStatusLine(
      messageData.content,
      `:closed_book: Closed by ${closerMention}`
    );

    await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }
}
