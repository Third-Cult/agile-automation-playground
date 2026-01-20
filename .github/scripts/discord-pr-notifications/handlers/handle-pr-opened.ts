import type { HandlerContext, Core, UserMapping } from '../types';
import { sendMessage, createThread, sendThreadMessage } from '../utils/discord';
import { saveMetadataToPR } from '../utils/github';
import { buildPRMessage } from '../utils/formatting';

export async function handlePROpened(
  context: HandlerContext,
  core: Core,
  botToken: string,
  channelId: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const isDraft = pr.draft;
  const prNumber = pr.number;
  const prTitle = pr.title;
  const prUrl = pr.html_url;
  const author = pr.user.login;
  const baseBranch = pr.base.ref;
  const headBranch = pr.head.ref;
  const prDescription = pr.body || '';

  // Get reviewers and their associative usernames
  const reviewers = pr.requested_reviewers || [];
  const reviewerLogins = reviewers.map((r) => r.login);

  if (!botToken || !channelId) {
    core.setFailed('DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID secrets must be set');
    return;
  }

  // Build and send message
  const message = buildPRMessage({
    prNumber,
    prTitle,
    prUrl,
    headBranch,
    baseBranch,
    author,
    prDescription,
    reviewerLogins,
    isDraft,
    userMapping,
  });

  const messageData = await sendMessage(botToken, channelId, message);
  const discordMessageId = messageData.id;

  // Create thread
  const threadName = `PR #${prNumber}: ${prTitle}`.substring(0, 100); // Discord thread name limit
  try {
    const threadData = await createThread(botToken, channelId, discordMessageId, threadName);
    if (threadData) {
      const threadId = threadData.id;

      // Post thread message
      await sendThreadMessage(botToken, threadId, ':thread: Keep all conversations/dialogue about the contents of the PR in this thread **or** in the PR\'s comments');

      // Store metadata in PR comment
      const metadata = {
        message_id: discordMessageId,
        thread_id: threadId,
        channel_id: channelId,
      };

      await saveMetadataToPR(context, prNumber, metadata);
    }
  } catch (e) {
    core.warning(`Failed to create thread: ${e instanceof Error ? e.message : String(e)}`);
  }
}
