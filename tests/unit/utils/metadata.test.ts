import { describe, it, expect } from 'vitest';
import { findMetadata, createMetadataComment } from '../../../.github/scripts/discord-pr-notifications/utils/metadata';
import type { GitHubComment, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

describe('metadata', () => {
  describe('findMetadata', () => {
    it('should find valid metadata comment', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comments: GitHubComment[] = [
        {
          id: 1,
          body: createMetadataComment(metadata),
          user: { login: 'bot', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toEqual(metadata);
    });

    it('should find metadata in middle of comments', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comments: GitHubComment[] = [
        {
          id: 1,
          body: 'Regular comment',
          user: { login: 'user1', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: createMetadataComment(metadata),
          user: { login: 'bot', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
        {
          id: 3,
          body: 'Another comment',
          user: { login: 'user2', id: 3 },
          created_at: '2024-01-03T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toEqual(metadata);
    });

    it('should find metadata in first comment', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comments: GitHubComment[] = [
        {
          id: 1,
          body: createMetadataComment(metadata),
          user: { login: 'bot', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'Regular comment',
          user: { login: 'user1', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toEqual(metadata);
    });

    it('should return null when no metadata found', () => {
      const comments: GitHubComment[] = [
        {
          id: 1,
          body: 'Regular comment',
          user: { login: 'user1', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toBeNull();
    });

    it('should handle invalid JSON in metadata comment', () => {
      const comments: GitHubComment[] = [
        {
          id: 1,
          body: '<!-- DISCORD_BOT_METADATA\ninvalid json\n-->',
          user: { login: 'bot', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'Regular comment',
          user: { login: 'user1', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toBeNull();
    });

    it('should skip comments with no body', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comments: GitHubComment[] = [
        {
          id: 1,
          body: undefined,
          user: { login: 'user1', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: createMetadataComment(metadata),
          user: { login: 'bot', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toEqual(metadata);
    });

    it('should find first metadata when multiple exist', () => {
      const metadata1: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const metadata2: DiscordMetadata = {
        message_id: 'msg-456',
        thread_id: 'thread-456',
        channel_id: 'channel-456',
      };

      const comments: GitHubComment[] = [
        {
          id: 1,
          body: createMetadataComment(metadata1),
          user: { login: 'bot', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: createMetadataComment(metadata2),
          user: { login: 'bot', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const found = findMetadata(comments);
      expect(found).toEqual(metadata1);
    });
  });

  describe('createMetadataComment', () => {
    it('should create valid metadata comment', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comment = createMetadataComment(metadata);

      expect(comment).toContain('<!-- DISCORD_BOT_METADATA');
      expect(comment).toContain('-->');
      expect(comment).toContain('msg-123');
      expect(comment).toContain('thread-123');
      expect(comment).toContain('channel-123');
    });

    it('should include all required fields', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comment = createMetadataComment(metadata);
      const parsed = JSON.parse(comment.match(/<!-- DISCORD_BOT_METADATA\n([\s\S]*?)\n-->/)![1]);

      expect(parsed).toHaveProperty('message_id');
      expect(parsed).toHaveProperty('thread_id');
      expect(parsed).toHaveProperty('channel_id');
    });

    it('should format JSON correctly', () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comment = createMetadataComment(metadata);
      const match = comment.match(/<!-- DISCORD_BOT_METADATA\n([\s\S]*?)\n-->/);
      expect(match).not.toBeNull();

      const parsed = JSON.parse(match![1]);
      expect(parsed).toEqual(metadata);
    });
  });
});
