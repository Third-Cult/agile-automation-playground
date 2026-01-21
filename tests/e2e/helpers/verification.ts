import { DiscordClient, type DiscordMessage, type DiscordThread } from './discord-client';
import { GitHubClient, type PRInfo } from './github-client';

/**
 * Verify Discord message contains expected content
 */
export function verifyMessageContent(
  message: DiscordMessage | null,
  expectedTexts: string[]
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!message) {
    return {
      passed: false,
      errors: ['Discord message not found'],
    };
  }

  for (const expectedText of expectedTexts) {
    if (!message.content.includes(expectedText)) {
      errors.push(`Message does not contain: "${expectedText}"`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Verify Discord message has a specific reaction
 */
export function verifyReaction(
  message: DiscordMessage | null,
  emoji: string,
  shouldExist: boolean = true
): { passed: boolean; error?: string } {
  if (!message) {
    return {
      passed: false,
      error: 'Discord message not found',
    };
  }

  const hasReaction = message.reactions?.some((r) => r.emoji.name === emoji) || false;

  if (shouldExist && !hasReaction) {
    return {
      passed: false,
      error: `Message does not have ${emoji} reaction`,
    };
  }

  if (!shouldExist && hasReaction) {
    return {
      passed: false,
      error: `Message has ${emoji} reaction but should not`,
    };
  }

  return { passed: true };
}

/**
 * Verify Discord thread state
 */
export async function verifyThreadState(
  discord: DiscordClient,
  threadId: string,
  expectedLocked?: boolean,
  expectedArchived?: boolean
): Promise<{ passed: boolean; error?: string }> {
  try {
    const thread = await discord.getThread(threadId);

    if (expectedLocked !== undefined && thread.locked !== expectedLocked) {
      return {
        passed: false,
        error: `Thread locked state is ${thread.locked}, expected ${expectedLocked}`,
      };
    }

    if (expectedArchived !== undefined && thread.archived !== expectedArchived) {
      return {
        passed: false,
        error: `Thread archived state is ${thread.archived}, expected ${expectedArchived}`,
      };
    }

    return { passed: true };
  } catch (error: any) {
    return {
      passed: false,
      error: `Failed to get thread state: ${error.message}`,
    };
  }
}

/**
 * Verify PR state
 */
export function verifyPRState(
  pr: PRInfo,
  expectedDraft?: boolean,
  expectedState?: string,
  expectedMerged?: boolean
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  if (expectedDraft !== undefined && pr.draft !== expectedDraft) {
    errors.push(`PR draft state is ${pr.draft}, expected ${expectedDraft}`);
  }

  if (expectedState !== undefined && pr.state !== expectedState) {
    errors.push(`PR state is ${pr.state}, expected ${expectedState}`);
  }

  if (expectedMerged !== undefined && pr.merged !== expectedMerged) {
    errors.push(`PR merged state is ${pr.merged}, expected ${expectedMerged}`);
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Verify PR has metadata comment
 */
export async function verifyPRMetadata(
  github: GitHubClient,
  prNumber: number
): Promise<{ passed: boolean; error?: string; metadata?: any }> {
  try {
    const comments = await github.getPRComments(prNumber);
    
    // Look for metadata comment - it uses newlines in the format:
    // <!-- DISCORD_BOT_METADATA
    // {json}
    // -->
    const METADATA_REGEX = /<!-- DISCORD_BOT_METADATA\n([\s\S]*?)\n-->/;
    
    const metadataComment = comments.find((comment) => {
      if (!comment.body) return false;
      return METADATA_REGEX.test(comment.body);
    });

    if (!metadataComment) {
      // Check if any comment contains the metadata marker (for debugging)
      const hasMarker = comments.some((c) => c.body?.includes('DISCORD_BOT_METADATA'));
      return {
        passed: false,
        error: hasMarker
          ? 'PR has metadata marker but format is incorrect'
          : 'PR does not have metadata comment',
      };
    }

    // Parse metadata
    const match = metadataComment.body.match(METADATA_REGEX);
    if (!match) {
      return {
        passed: false,
        error: 'Metadata comment found but could not parse',
        metadata: metadataComment.body,
      };
    }

    try {
      const metadata = JSON.parse(match[1]);
      return {
        passed: true,
        metadata,
      };
    } catch (error) {
      return {
        passed: false,
        error: `Failed to parse metadata JSON: ${error}`,
        metadata: metadataComment.body,
      };
    }
  } catch (error: any) {
    return {
      passed: false,
      error: `Failed to get PR comments: ${error.message}`,
    };
  }
}

/**
 * Verify thread message exists
 */
export async function verifyThreadMessage(
  discord: DiscordClient,
  threadId: string,
  expectedText: string
): Promise<{ passed: boolean; error?: string; message?: DiscordMessage }> {
  try {
    const messages = await discord.getThreadMessages(threadId, 50);
    
    const matchingMessage = messages.find((msg) =>
      msg.content.includes(expectedText)
    );

    if (!matchingMessage) {
      return {
        passed: false,
        error: `Thread message with text "${expectedText}" not found`,
      };
    }

    return {
      passed: true,
      message: matchingMessage,
    };
  } catch (error: any) {
    return {
      passed: false,
      error: `Failed to get thread messages: ${error.message}`,
    };
  }
}

/**
 * Verify Discord message formatting for PR opened (ready) messages without reviewers
 * This verifies the exact structure including newlines between sections
 */
export function verifyPROpenedReadyFormat(
  message: DiscordMessage | null,
  prNumber: number,
  prTitle: string,
  prUrl: string,
  headBranch: string,
  baseBranch: string,
  author: string,
  prDescription?: string
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!message) {
    return {
      passed: false,
      errors: ['Discord message not found'],
    };
  }

  const content = message.content;
  const lines = content.split('\n');

  // Expected structure (same as draft, but with "Ready for Review" status):
  // Line 0: ## [PR #X: Title](url)
  // Line 1: `headBranch` -> `baseBranch`
  // Line 2: (empty line)
  // Line 3: **Author:** @username
  // Lines 4-N: Description (if exists) + empty line
  // Next: ⚠️ WARNING::No reviewers assigned:
  // Next: PR has to be reviewed by another member before merging.
  // Next: (empty line)
  // Last: **Status**: :eyes: Ready for Review

  let currentLine = 0;

  // Verify header format: ## [PR #X: Title](url)
  const headerPattern = new RegExp(`^## \\[PR #${prNumber}: ${prTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(${prUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`);
  if (!headerPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Header): Expected "## [PR #${prNumber}: ${prTitle}](${prUrl})", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify branch format: `headBranch` -> `baseBranch`
  const branchPattern = new RegExp(`^\`${headBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` -> \`${baseBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`$`);
  if (!branchPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Branch): Expected "\`${headBranch}\` -> \`${baseBranch}\`", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify empty line after branch
  if (lines[currentLine]?.trim() !== '') {
    errors.push(`Line ${currentLine}: Expected empty line after branch, Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify Author format: **Author:** @username or <@discordId>
  const authorLine = lines[currentLine] || '';
  if (!authorLine.startsWith('**Author:**')) {
    errors.push(`Line ${currentLine} (Author): Expected line starting with "**Author:**", Got: "${authorLine}"`);
  } else if (!authorLine.includes('@')) {
    errors.push(`Line ${currentLine} (Author): Expected author mention (should contain @), Got: "${authorLine}"`);
  }
  currentLine++;

  // Verify description if provided
  if (prDescription && prDescription.trim() !== '') {
    const descriptionLines = prDescription.split('\n');
    for (let i = 0; i < descriptionLines.length; i++) {
      if (lines[currentLine]?.trim() !== descriptionLines[i]?.trim()) {
        errors.push(`Line ${currentLine} (Description line ${i + 1}): Expected "${descriptionLines[i]}", Got: "${lines[currentLine]}"`);
      }
      currentLine++;
    }
    
    // Verify empty line after description
    if (lines[currentLine]?.trim() !== '') {
      errors.push(`Line ${currentLine}: Expected empty line after description, Got: "${lines[currentLine]}"`);
    }
    currentLine++;
  }

  // Verify warning format (no reviewers): ⚠️ WARNING::No reviewers assigned:
  const warningPattern = /^⚠️ WARNING::No reviewers assigned:$/;
  if (!warningPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Warning): Expected "⚠️ WARNING::No reviewers assigned:", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify warning message: PR has to be reviewed by another member before merging.
  const warningMessage = 'PR has to be reviewed by another member before merging.';
  if ((lines[currentLine] || '').trim() !== warningMessage) {
    errors.push(`Line ${currentLine} (Warning message): Expected "${warningMessage}", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify empty line before status
  if (lines[currentLine]?.trim() !== '') {
    errors.push(`Line ${currentLine}: Expected empty line before status, Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify status format: **Status**: :eyes: Ready for Review
  const statusPattern = /^\*\*Status\*\*: :eyes: Ready for Review$/;
  if (!statusPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Status): Expected "**Status**: :eyes: Ready for Review", Got: "${lines[currentLine]}"`);
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Verify Discord message formatting for PR opened (draft) messages
 * This verifies the exact structure including newlines between sections
 */
export function verifyPROpenedDraftFormat(
  message: DiscordMessage | null,
  prNumber: number,
  prTitle: string,
  prUrl: string,
  headBranch: string,
  baseBranch: string,
  author: string,
  prDescription?: string
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!message) {
    return {
      passed: false,
      errors: ['Discord message not found'],
    };
  }

  const content = message.content;
  const lines = content.split('\n');

  // Expected structure:
  // Line 0: ## [PR #X: Title](url)
  // Line 1: `headBranch` -> `baseBranch`
  // Line 2: (empty line)
  // Line 3: **Author:** @username
  // Lines 4-N: Description (if exists) + empty line
  // Next: ⚠️ WARNING::No reviewers assigned:
  // Next: PR has to be reviewed by another member before merging.
  // Last: **Status**: :pencil: Draft - In Progress

  let currentLine = 0;

  // Verify header format: ## [PR #X: Title](url)
  const headerPattern = new RegExp(`^## \\[PR #${prNumber}: ${prTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(${prUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`);
  if (!headerPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Header): Expected "## [PR #${prNumber}: ${prTitle}](${prUrl})", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify branch format: `headBranch` -> `baseBranch`
  const branchPattern = new RegExp(`^\`${headBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` -> \`${baseBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`$`);
  if (!branchPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Branch): Expected "\`${headBranch}\` -> \`${baseBranch}\`", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify empty line after branch
  if (lines[currentLine]?.trim() !== '') {
    errors.push(`Line ${currentLine}: Expected empty line after branch, Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify Author format: **Author:** @username or <@discordId>
  // The author might be mapped to Discord, so we just check the format exists
  const authorLine = lines[currentLine] || '';
  if (!authorLine.startsWith('**Author:**')) {
    errors.push(`Line ${currentLine} (Author): Expected line starting with "**Author:**", Got: "${authorLine}"`);
  } else if (!authorLine.includes('@')) {
    errors.push(`Line ${currentLine} (Author): Expected author mention (should contain @), Got: "${authorLine}"`);
  }
  // Note: We don't check for exact username match since it might be mapped to Discord ID
  currentLine++;

  // Verify description if provided
  if (prDescription && prDescription.trim() !== '') {
    // Description can span multiple lines, so we need to find where it ends
    const descriptionLines = prDescription.split('\n');
    for (let i = 0; i < descriptionLines.length; i++) {
      if (lines[currentLine]?.trim() !== descriptionLines[i]?.trim()) {
        errors.push(`Line ${currentLine} (Description line ${i + 1}): Expected "${descriptionLines[i]}", Got: "${lines[currentLine]}"`);
      }
      currentLine++;
    }
    
    // Verify empty line after description
    if (lines[currentLine]?.trim() !== '') {
      errors.push(`Line ${currentLine}: Expected empty line after description, Got: "${lines[currentLine]}"`);
    }
    currentLine++;
  }

  // Verify warning format (no reviewers): ⚠️ WARNING::No reviewers assigned:
  const warningPattern = /^⚠️ WARNING::No reviewers assigned:$/;
  if (!warningPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Warning): Expected "⚠️ WARNING::No reviewers assigned:", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify warning message: PR has to be reviewed by another member before merging.
  const warningMessage = 'PR has to be reviewed by another member before merging.';
  if ((lines[currentLine] || '').trim() !== warningMessage) {
    errors.push(`Line ${currentLine} (Warning message): Expected "${warningMessage}", Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify empty line before status
  if (lines[currentLine]?.trim() !== '') {
    errors.push(`Line ${currentLine}: Expected empty line before status, Got: "${lines[currentLine]}"`);
  }
  currentLine++;

  // Verify status format: **Status**: :pencil: Draft - In Progress
  const statusPattern = /^\*\*Status\*\*: :pencil: Draft - In Progress$/;
  if (!statusPattern.test(lines[currentLine] || '')) {
    errors.push(`Line ${currentLine} (Status): Expected "**Status**: :pencil: Draft - In Progress", Got: "${lines[currentLine]}"`);
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}