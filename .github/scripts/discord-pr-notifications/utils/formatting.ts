import type { UserMapping } from '../types';

/**
 * Map GitHub username to Discord mention
 */
export function mapToDiscord(
  githubUsername: string,
  userMapping: UserMapping
): string {
  return userMapping[githubUsername]
    ? `<@${userMapping[githubUsername]}>`
    : `@${githubUsername}`;
}

/**
 * Build the initial PR message for Discord
 */
export function buildPRMessage(params: {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  headBranch: string;
  baseBranch: string;
  author: string;
  prDescription: string;
  reviewerLogins: string[];
  isDraft: boolean;
  userMapping: UserMapping;
}): string {
  const { prNumber, prTitle, prUrl, headBranch, baseBranch, author, prDescription, reviewerLogins, isDraft, userMapping } = params;

  let message = `## [PR #${prNumber}: ${prTitle}](${prUrl})\n`;
  message += `-# \`${headBranch}\` -> \`${baseBranch}\`\n\n`;
  message += `**Author:** ${mapToDiscord(author, userMapping)}\n`;

  // Add PR description if it exists
  if (prDescription && prDescription.trim() !== '') {
    message += `${prDescription}\n\n`;
  }

  // Reviewers section
  if (reviewerLogins.length > 0) {
    const reviewerMentions = reviewerLogins.map((login) => mapToDiscord(login, userMapping)).join(' ');
    message += `**Reviewers:** ${reviewerMentions}\n\n`;
  } else {
    // ANSI warning format in code block
    message += `\`\`\`ansi\n`;
    message += `\u001b[2;33mWARNING::No reviewers assigned:\u001b[0m\n`;
    message += `PR has to be reviewed by another member before merging.\n`;
    message += `\`\`\`\n\n`;
  }

  // Status - check if draft
  if (isDraft) {
    message += `**Status**: :pencil: Draft - In Progress\n`;
  } else {
    message += `**Status**: :eyes: Ready for Review\n`;
  }

  return message;
}

/**
 * Update the reviewers line in a message
 */
export function updateReviewersLine(
  content: string,
  reviewerLogins: string[],
  userMapping: UserMapping
): string {
  const lines = content.split('\n');
  let beforeReviewers: string[] = [];
  let afterReviewers: string[] = [];
  let reviewersLineIndex = -1;

  // Find the reviewers line or no reviewers warning
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Reviewers:') || lines[i].includes('WARNING::No reviewers assigned')) {
      reviewersLineIndex = i;
      break;
    }
  }

  if (reviewersLineIndex >= 0) {
    beforeReviewers = lines.slice(0, reviewersLineIndex);
    afterReviewers = lines.slice(reviewersLineIndex + 1);
  } else {
    // If no reviewers line found, assume it should be after the Author line
    const authorLineIndex = lines.findIndex((line) => line.startsWith('**Author:**'));
    if (authorLineIndex >= 0) {
      beforeReviewers = lines.slice(0, authorLineIndex + 1);
      afterReviewers = lines.slice(authorLineIndex + 1);
    } else {
      beforeReviewers = lines;
      afterReviewers = [];
    }
  }

  // Rebuild the message with current reviewers
  const rebuiltLines = [...beforeReviewers];

  if (reviewerLogins.length > 0) {
    const reviewerMentions = reviewerLogins.map((login) => mapToDiscord(login, userMapping)).join(' ');
    rebuiltLines.push(`**Reviewers:** ${reviewerMentions}\n\n`);
  } else {
    rebuiltLines.push(`\`\`\`ansi\n`);
    rebuiltLines.push(`\u001b[2;33mWARNING::No reviewers assigned:\u001b[0m`);
    rebuiltLines.push(`PR has to be reviewed by another member before merging.\n`);
    rebuiltLines.push(`\`\`\`\n\n`);
  }

  rebuiltLines.push(...afterReviewers);
  return rebuiltLines.join('\n');
}

/**
 * Update the status line in a message
 */
export function updateStatusLine(content: string, newStatus: string): string {
  const lines = content.split('\n');
  const newLines = lines.map((line) => {
    if (line.startsWith('**Status**:')) {
      return `**Status**: ${newStatus}`;
    }
    return line;
  });

  // If no status line was found, add it after Reviewers
  const hasStatus = newLines.some((line) => line.startsWith('**Status**:'));
  if (!hasStatus) {
    const reviewersIndex = newLines.findIndex(
      (line) => line.includes('Reviewers:') || line.includes('WARNING::No reviewers assigned')
    );
    if (reviewersIndex >= 0) {
      newLines.splice(reviewersIndex + 1, 0, `**Status**: ${newStatus}`);
    } else {
      newLines.push(`**Status**: ${newStatus}`);
    }
  }

  return newLines.join('\n');
}

/**
 * Replace status line using regex (for simple replacements)
 */
export function replaceStatusLine(content: string, newStatus: string): string {
  return content.replace(/\*\*Status\*\*: .*/g, `**Status**: ${newStatus}`);
}
