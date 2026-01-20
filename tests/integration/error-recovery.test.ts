import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePRReadyForReview } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-ready-for-review';
import { handleReviewerAdded } from '../../.github/scripts/discord-pr-notifications/handlers/handle-reviewer-added';
import { createMockGitHubContext } from '../mocks/github';
import * as discord from '../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping } from '../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../.github/scripts/discord-pr-notifications/utils/github');

describe('Error Recovery Integration Tests', () => {
  const botToken = 'test-bot-token';
  const userMapping: UserMapping = {};

  const mockCore: Core = {
    setFailed: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Missing Metadata Scenarios', () => {
    it('should warn and post comment when metadata missing', async () => {
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
        action: 'ready_for_review',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue(null);
      vi.mocked(github.postMetadataMissingComment).mockResolvedValue();

      await handlePRReadyForReview(context, mockCore, botToken, userMapping);

      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('No Discord thread found')
      );
      expect(github.postMetadataMissingComment).toHaveBeenCalledWith(context, 123);
      expect(mockCore.setFailed).not.toHaveBeenCalled();
    });

    it('should continue execution when metadata missing in reviewer added', async () => {
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
        requested_reviewer: { login: 'reviewer1', id: 2, type: 'User' },
        action: 'review_requested',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue(null);
      vi.mocked(github.postMetadataMissingComment).mockResolvedValue();

      await handleReviewerAdded(context, mockCore, botToken, userMapping);

      expect(mockCore.warning).toHaveBeenCalled();
      expect(github.postMetadataMissingComment).toHaveBeenCalled();
      expect(discord.sendThreadMessage).not.toHaveBeenCalled();
    });
  });

  describe('API Failure Scenarios', () => {
    it('should handle Discord API temporarily unavailable', async () => {
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
        action: 'ready_for_review',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue({
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      });
      vi.mocked(discord.getMessage).mockRejectedValue(new Error('Discord API unavailable'));

      await handlePRReadyForReview(context, mockCore, botToken, userMapping);

      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to edit parent message')
      );
    });

    it('should handle GitHub API temporarily unavailable', async () => {
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
        action: 'ready_for_review',
      };

      vi.mocked(github.getMetadataFromPR).mockRejectedValue(new Error('GitHub API unavailable'));

      await expect(
        handlePRReadyForReview(context, mockCore, botToken, userMapping)
      ).rejects.toThrow();
    });
  });

  describe('Partial Failures', () => {
    it('should warn when thread creation fails but message sent', async () => {
      const { handlePROpened } = await import(
        '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-opened'
      );

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
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockRejectedValue(new Error('Thread creation failed'));

      await handlePROpened(context, mockCore, botToken, 'channel-123', userMapping);

      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create thread')
      );
      expect(github.saveMetadataToPR).not.toHaveBeenCalled();
    });

    it('should continue when message edit fails but thread message succeeds', async () => {
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
        action: 'ready_for_review',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue({
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      });
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :pencil: Draft - In Progress',
      });
      vi.mocked(discord.editMessage).mockRejectedValue(new Error('Edit failed'));
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();

      await handlePRReadyForReview(context, mockCore, botToken, userMapping);

      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to edit parent message')
      );
      expect(discord.sendThreadMessage).toHaveBeenCalled();
    });
  });
});
