import type { DiscordMetadata, GitHubComment } from '../types';

const METADATA_REGEX = /<!-- DISCORD_BOT_METADATA\n([\s\S]*?)\n-->/;

/**
 * Find and parse Discord metadata from PR comments
 */
export function findMetadata(comments: GitHubComment[]): DiscordMetadata | null {
  for (const comment of comments) {
    if (!comment.body) {
      continue;
    }
    const match = comment.body.match(METADATA_REGEX);
    if (match) {
      try {
        return JSON.parse(match[1]) as DiscordMetadata;
      } catch (e) {
        // Invalid JSON, continue searching
        continue;
      }
    }
  }
  return null;
}

/**
 * Create a hidden comment body containing metadata
 */
export function createMetadataComment(metadata: DiscordMetadata): string {
  return `<!-- DISCORD_BOT_METADATA\n${JSON.stringify(metadata, null, 2)}\n-->`;
}
