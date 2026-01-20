import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePROpened } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-opened';
import { handleReviewerAdded } from '../../.github/scripts/discord-pr-notifications/handlers/handle-reviewer-added';
import { handlePRReview } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-review';
import { createMockGitHubContext } from '../mocks/github';
import * as discord from '../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../.github/scripts/discord-pr-notifications/utils/github');

describe('Edge Cases Integration Tests', () => {
  const botToken = 'test-bot-token';
  const channelId = 'channel-123';
  const userMapping: UserMapping = {
    'test-author': 'author-discord-id',
    'reviewer1': 'reviewer1-discord-id',
  };

  const mockCore: Core = {
    setFailed: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Large Data', () => {
    it('should handle PR with very long description', async () => {
      const longDescription = 'A'.repeat(5000);
      const context = createMockGitHubContext();
      context.payload = {
        pull_request: {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/123',
          body: longDescription,
          draft: false,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      const message = vi.mocked(discord.sendMessage).mock.calls[0][2];
      expect(message).toContain(longDescription);
    });

    it('should handle PR with many reviewers (10+)', async () => {
      const manyReviewers = Array.from({ length: 15 }, (_, i) => ({
        login: `reviewer${i + 1}`,
        id: i + 2,
        type: 'User' as const,
      }));

      const context = createMockGitHubContext();
      context.payload = {
        pull_request: {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/123',
          body: '',
          draft: false,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: manyReviewers,
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      const message = vi.mocked(discord.sendMessage).mock.calls[0][2];
      manyReviewers.forEach((reviewer) => {
        expect(message).toContain(reviewer.login);
      });
    });

    it('should truncate PR title at 100 character limit for thread name', async () => {
      const longTitle = 'A'.repeat(150);
      const context = createMockGitHubContext();
      context.payload = {
        pull_request: {
          number: 123,
          title: longTitle,
          html_url: 'https://github.com/test/repo/pull/123',
          body: '',
          draft: false,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      const threadName = vi.mocked(discord.createThread).mock.calls[0][3];
      expect(threadName.length).toBeLessThanOrEqual(100);
      expect(threadName).toContain('PR #123:');
    });
  });

  describe('Special Characters', () => {
    it('should handle usernames with special characters', async () => {
      const context = createMockGitHubContext();
      context.payload = {
        pull_request: {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/123',
          body: '',
          draft: false,
          state: 'open',
          user: { login: 'user-name_123', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [{ login: 'reviewer.name', id: 2, type: 'User' }],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      const message = vi.mocked(discord.sendMessage).mock.calls[0][2];
      expect(message).toContain('user-name_123');
      expect(message).toContain('reviewer.name');
    });

    it('should handle PR title/description with emojis and markdown', async () => {
      const context = createMockGitHubContext();
      context.payload = {
        pull_request: {
          number: 123,
          title: '🚀 Feature: Add new functionality',
          html_url: 'https://github.com/test/repo/pull/123',
          body: '## Description\n\nThis PR adds **new features** with:\n- Item 1\n- Item 2\n\n```typescript\nconst code = "example";\n```',
          draft: false,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      const message = vi.mocked(discord.sendMessage).mock.calls[0][2];
      expect(message).toContain('🚀');
      expect(message).toContain('**new features**');
    });

    it('should handle review body with code blocks and mentions', async () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const context = createMockGitHubContext();
      context.payload = {
        pull_request: {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/123',
          body: '',
          draft: false,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [],
        },
        review: {
          id: 456,
          user: { login: 'reviewer1', id: 2 },
          state: 'approved',
          body: 'Great work! @test-author\n\n```typescript\nconst example = true;\n```\n\nPlease merge when ready.',
        },
        action: 'submitted',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
      vi.mocked(discord.removeReaction).mockResolvedValue();
      vi.mocked(discord.addReaction).mockResolvedValue();
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(discord.lockThread).mockResolvedValue();
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :eyes: Ready for Review',
      });
      vi.mocked(discord.editMessage).mockResolvedValue();

      await handlePRReview(context, mockCore, botToken, userMapping);

      const threadMessage = vi.mocked(discord.sendThreadMessage).mock.calls[0][2];
      expect(threadMessage).toContain('Great work!');
      expect(threadMessage).toContain('@test-author');
      expect(threadMessage).toContain('```typescript');
    });
  });

  describe('Concurrent Events', () => {
    it('should handle multiple reviewers added simultaneously', async () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      // Simulate two reviewer added events happening concurrently
      const context1 = createMockGitHubContext();
      context1.payload = {
        pull_request: {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/123',
          body: '',
          draft: false,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [
            { login: 'reviewer1', id: 2, type: 'User' },
            { login: 'reviewer2', id: 3, type: 'User' },
          ],
        },
        requested_reviewer: { login: 'reviewer1', id: 2, type: 'User' },
        action: 'review_requested',
      };

      const context2 = createMockGitHubContext();
      context2.payload = {
        ...context1.payload,
        requested_reviewer: { login: 'reviewer2', id: 3, type: 'User' },
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Reviewers:**',
      });
      vi.mocked(discord.editMessage).mockResolvedValue();
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();

      // Execute both handlers
      await Promise.all([
        handleReviewerAdded(context1, mockCore, botToken, userMapping),
        handleReviewerAdded(context2, mockCore, botToken, userMapping),
      ]);

      // Both should update with all current reviewers
      const editCalls = vi.mocked(discord.editMessage).mock.calls;
      editCalls.forEach((call) => {
        const content = call[3];
        expect(content).toContain('reviewer1');
        expect(content).toContain('reviewer2');
      });
    });
  });
});
