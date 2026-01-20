import type { HandlerContext, Core, UserMapping } from '../types';
import { getMessage, editMessage, sendThreadMessage, addReaction, removeReaction, lockThread } from '../utils/discord';
import { getMetadataFromPR, getReviewDetails, postMetadataMissingComment } from '../utils/github';
import { mapToDiscord } from '../utils/formatting';

export async function handlePRReview(
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
  const author = pr.user.login;
  const reviewer = review.user.login;
  const reviewState = review.state; // 'approved', 'changes_requested', or 'commented'

  // Get the review body - try from payload first, then fetch from API if needed
  let reviewBody = review.body || '';

  // If review body is empty, try fetching the full review details
  if (!reviewBody || reviewBody.trim() === '') {
    try {
      reviewBody = await getReviewDetails(context, prNumber, review.id);
    } catch (e) {
      core.warning(`Could not fetch review details: ${e instanceof Error ? e.message : String(e)}`);
      reviewBody = '';
    }
  }

  // Skip if it's just a comment (not approval or changes requested)
  if (reviewState === 'commented') {
    core.info('Review is just a comment, skipping.');
    return;
  }

  if (!botToken) {
    core.setFailed('DISCORD_BOT_TOKEN secret must be set');
    return;
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

  // Determine emoji and status text based on review state
  let emoji = '';
  if (reviewState === 'approved') {
    emoji = '✅';
  } else if (reviewState === 'changes_requested') {
    emoji = '❌';
  }

  // Remove existing reactions before adding new one (mutually exclusive)
  if (emoji) {
    // Remove opposite reaction if present
    if (reviewState === 'approved') {
      // Remove ❌ if present
      try {
        await removeReaction(botToken, metadata.channel_id, metadata.message_id, '❌');
      } catch (e) {
        // Reaction might not exist, that's okay
      }
    } else if (reviewState === 'changes_requested') {
      // Remove ✅ if present
      try {
        await removeReaction(botToken, metadata.channel_id, metadata.message_id, '✅');
      } catch (e) {
        // Reaction might not exist, that's okay
      }
    }

    // Add new reaction
    await addReaction(botToken, metadata.channel_id, metadata.message_id, emoji);
  }

  // Build review message for thread
  const reviewerMention = mapToDiscord(reviewer, userMapping);
  const authorMention = mapToDiscord(author, userMapping);

  core.info(`Review body from payload: ${review.body || '(empty)'}`);
  core.info(`Review body after fetch: ${reviewBody || '(empty)'}`);

  let reviewMessage = '';
  if (reviewState === 'approved') {
    reviewMessage = `:white_check_mark: ${authorMention} - ${reviewerMention} has approved the PR\n`;
    if (reviewBody && reviewBody.trim() !== '') {
      reviewMessage += `> ${reviewBody.replace(/\n/g, '\n> ')}\n\n`;
    }
    reviewMessage += `Feel free to merge if all other conditions have been met`;
  } else if (reviewState === 'changes_requested') {
    reviewMessage = `:tools: ${authorMention} - changes have been requested by ${reviewerMention}.\n`;
    if (reviewBody && reviewBody.trim() !== '') {
      reviewMessage += `> ${reviewBody.replace(/\n/g, '\n> ')}\n\n`;
    }
    reviewMessage += `Please resolve them and re-request a review.`;
  }

  // Post in thread
  if (metadata.thread_id) {
    await sendThreadMessage(botToken, metadata.thread_id, reviewMessage);

    // Lock thread if approved
    if (reviewState === 'approved') {
      try {
        await lockThread(botToken, metadata.thread_id, true);
      } catch (e) {
        core.warning(`Failed to lock thread: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Update parent message with review status
  try {
    const messageData = await getMessage(botToken, metadata.channel_id, metadata.message_id);
    let content = messageData.content;

    // Process lines and update status - remove approval/changes lines, only keep Status
    const lines = content.split('\n');
    let newLines: string[] = [];
    let statusLineFound = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Update status line if found
      if (line.startsWith('**Status**:')) {
        if (reviewState === 'approved') {
          newLines.push(`**Status**: :white_check_mark: Approved by ${reviewerMention}`);
        } else if (reviewState === 'changes_requested') {
          newLines.push(`**Status**: :tools: Changes Requested by ${reviewerMention}`);
        } else {
          newLines.push(line); // Keep original if unknown state
        }
        statusLineFound = true;
      } else {
        newLines.push(line);
      }
    }

    // If no status line was found, add it after Reviewers
    if (!statusLineFound) {
      const reviewersIndex = newLines.findIndex(
        (line) => line.includes('Reviewers:') || line.includes('WARNING::No reviewers assigned')
      );
      if (reviewersIndex >= 0) {
        newLines.splice(
          reviewersIndex + 1,
          0,
          reviewState === 'approved'
            ? `**Status**: :white_check_mark: Approved by ${reviewerMention}`
            : `**Status**: :tools: Changes Requested by ${reviewerMention}`
        );
      } else {
        newLines.push(
          reviewState === 'approved'
            ? `**Status**: :white_check_mark: Approved by ${reviewerMention}`
            : `**Status**: :tools: Changes Requested by ${reviewerMention}`
        );
      }
    }

    content = newLines.join('\n');

    await editMessage(botToken, metadata.channel_id, metadata.message_id, content);
  } catch (e) {
    core.warning(`Failed to edit parent message: ${e instanceof Error ? e.message : String(e)}`);
  }
}
