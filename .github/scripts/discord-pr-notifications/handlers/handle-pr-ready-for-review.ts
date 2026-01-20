import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage } from '../utils/discord';
import { getMetadataFromPR, postMetadataMissingComment } from '../utils/github';
import { replaceStatusLine } from '../utils/formatting';

export async function handlePRReadyForReview(
  context: HandlerContext,
  core: Core,
  botToken: string,
  _userMapping: UserMapping
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

  // Remove DRAFT marker from parent message
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const updatedContent = replaceStatusLine(
      messageData.content,
      ':eyes: Ready for Review'
    );

    await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Post in thread
  await sendThreadMessage(botToken, metadata.thread_id, ':eyes: This PR is now ready for review!');
}
