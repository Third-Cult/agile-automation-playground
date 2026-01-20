import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage, addReaction, archiveThread } from '../utils/discord';
import { getMetadataFromPR, postMetadataMissingComment } from '../utils/github';
import { replaceStatusLine, mapToDiscord } from '../utils/formatting';

export async function handlePRMerged(
  context: HandlerContext,
  core: Core,
  botToken: string,
  userMapping: UserMapping
): Promise<void> {
  const pr = context.payload.pull_request;
  const prNumber = pr.number;
  const prUrl = pr.html_url;
  const baseBranch = pr.base.ref;
  const author = pr.user.login;
  const merger = pr.merged_by ? pr.merged_by.login : 'unknown';
  const mergeCommitSha = pr.merge_commit_sha;

  if (!botToken) {
    core.setFailed('DISCORD_BOT_TOKEN secret must be set');
    return;
  }

  // Get merge commit message
  let mergeMessage = '';
  if (mergeCommitSha) {
    try {
      const commit = await context.github.rest.repos.getCommit({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: mergeCommitSha,
      });
      mergeMessage = commit.data.commit.message.split('\n')[0];
    } catch (e) {
      core.warning(`Could not fetch merge commit: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const metadata = await getMetadataFromPR(context, prNumber);

  if (!metadata) {
    core.warning('No Discord metadata found for this PR. Skipping.');
    try {
      await postMetadataMissingComment(context, prNumber);
    } catch (e) {
      core.warning(`Failed to comment in PR: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  // Add celebration emoji reaction
  try {
    await addReaction(botToken, metadata.channel_id, metadata.message_id, '🎉');
  } catch (e) {
    core.warning(`Failed to add reaction: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Build merge message
  const authorMention = mapToDiscord(author, userMapping);
  const mergerMention = mapToDiscord(merger, userMapping);
  let mergeNotification = `:tada: ${authorMention} - [PR #${prNumber}](${prUrl}) has been merged into \`${baseBranch}\`\n\n`;
  if (mergeMessage) {
    mergeNotification += `> ${mergeMessage}\n\n`;
  }
  mergeNotification += `Remember to delete associative branch if it is no longer needed!`;

  // Post in thread
  if (metadata.thread_id) {
    await sendThreadMessage(botToken, metadata.thread_id, mergeNotification);

    // Archive and lock the thread
    try {
      await archiveThread(botToken, metadata.thread_id);
    } catch (e) {
      core.warning(`Failed to archive thread: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Update parent message status
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    const updatedContent = replaceStatusLine(
      messageData.content,
      `:tada: Merged by ${mergerMention}`
    );

    await editMessage(botToken, metadata.channel_id, metadata.message_id, updatedContent);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }
}
