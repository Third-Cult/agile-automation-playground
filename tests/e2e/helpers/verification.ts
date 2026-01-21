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
