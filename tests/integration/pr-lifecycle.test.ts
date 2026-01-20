import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePROpened } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-opened';
import { handlePRReadyForReview } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-ready-for-review';
import { handleReviewerAdded } from '../../.github/scripts/discord-pr-notifications/handlers/handle-reviewer-added';
import { handlePRReview } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-review';
import { handlePRSynchronize } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-synchronize';
import { handlePRMerged } from '../../.github/scripts/discord-pr-notifications/handlers/handle-pr-merged';
import { createMockGitHubContext } from '../mocks/github';
import * as discord from '../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../.github/scripts/discord-pr-notifications/utils/github';
import { createMetadataComment } from '../../.github/scripts/discord-pr-notifications/utils/metadata';
import type { Core, UserMapping, DiscordMetadata } from '../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../.github/scripts/discord-pr-notifications/utils/github');

describe('PR Lifecycle Integration Tests', () => {
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

  let metadata: DiscordMetadata;

  beforeEach(() => {
    vi.clearAllMocks();
    metadata = {
      message_id: 'msg-123',
      thread_id: 'thread-123',
      channel_id: 'channel-123',
    };
  });

  describe('Draft → Ready → Review → Approved → Merged', () => {
    it('should handle complete lifecycle', async () => {
      const context = createMockGitHubContext();

      // 1. PR opened as draft
      context.payload = {
        pull_request: {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/123',
          body: 'PR description',
          draft: true,
          state: 'open',
          user: { login: 'test-author', id: 1 },
          base: { ref: 'main' },
          head: { ref: 'feature' },
          requested_reviewers: [{ login: 'reviewer1', id: 2, type: 'User' }],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      expect(discord.sendMessage).toHaveBeenCalledWith(
        botToken,
        channelId,
        expect.stringContaining('Draft - In Progress')
      );
      expect(github.saveMetadataToPR).toHaveBeenCalledWith(
        context,
        123,
        metadata
      );

      // 2. PR marked ready for review
      vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :pencil: Draft - In Progress',
      });
      vi.mocked(discord.editMessage).mockResolvedValue();

      await handlePRReadyForReview(context, mockCore, botToken, userMapping);

      expect(discord.editMessage).toHaveBeenCalledWith(
        botToken,
        'channel-123',
        'msg-123',
        expect.stringContaining(':eyes: Ready for Review')
      );

      // 3. Reviewer added
      context.payload = {
        ...context.payload,
        pull_request: {
          ...context.payload.pull_request,
          requested_reviewers: [{ login: 'reviewer1', id: 2, type: 'User' }],
        },
        requested_reviewer: { login: 'reviewer1', id: 2, type: 'User' },
        action: 'review_requested',
      };

      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :eyes: Ready for Review\n**Reviewers:**',
      });

      await handleReviewerAdded(context, mockCore, botToken, userMapping);

      expect(discord.sendThreadMessage).toHaveBeenCalledWith(
        botToken,
        'thread-123',
        expect.stringContaining('reviewer1')
      );

      // 4. Review submitted (approved)
      context.payload = {
        ...context.payload,
        review: {
          id: 456,
          user: { login: 'reviewer1', id: 2 },
          state: 'approved',
          body: 'Looks good!',
        },
        action: 'submitted',
      };

      vi.mocked(discord.removeReaction).mockResolvedValue();
      vi.mocked(discord.addReaction).mockResolvedValue();
      vi.mocked(discord.lockThread).mockResolvedValue();
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :eyes: Ready for Review',
      });

      await handlePRReview(context, mockCore, botToken, userMapping);

      expect(discord.addReaction).toHaveBeenCalledWith(
        botToken,
        'channel-123',
        'msg-123',
        '✅'
      );
      expect(discord.lockThread).toHaveBeenCalledWith(botToken, 'thread-123', true);

      // 5. New commits pushed (synchronize)
      context.payload = {
        ...context.payload,
        action: 'synchronize',
      };

      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :white_check_mark: Approved by @reviewer1',
      });
      vi.mocked(github.requestReviewers).mockResolvedValue();

      await handlePRSynchronize(context, mockCore, botToken, userMapping);

      expect(discord.lockThread).toHaveBeenCalledWith(botToken, 'thread-123', false);
      expect(discord.editMessage).toHaveBeenCalledWith(
        botToken,
        'channel-123',
        'msg-123',
        expect.stringContaining(':eyes: Ready for Review')
      );
      expect(github.requestReviewers).toHaveBeenCalled();

      // 6. PR merged
      context.payload = {
        ...context.payload,
        pull_request: {
          ...context.payload.pull_request,
          merged: true,
          merged_by: { login: 'merger', id: 3 },
          merge_commit_sha: 'abc123',
        },
        action: 'closed',
      };

      vi.mocked(discord.addReaction).mockResolvedValue();
      vi.mocked(discord.archiveThread).mockResolvedValue();
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :white_check_mark: Approved',
      });

      await handlePRMerged(context, mockCore, botToken, userMapping);

      expect(discord.addReaction).toHaveBeenCalledWith(
        botToken,
        'channel-123',
        'msg-123',
        '🎉'
      );
      expect(discord.archiveThread).toHaveBeenCalledWith(botToken, 'thread-123');
    });
  });

  describe('Ready → Changes Requested → Dismissed → Merged', () => {
    it('should handle changes requested flow', async () => {
      const context = createMockGitHubContext();

      // 1. PR opened (ready)
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
          requested_reviewers: [{ login: 'reviewer1', id: 2, type: 'User' }],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, userMapping);

      // 2. Review submitted (changes requested)
      context.payload = {
        ...context.payload,
        review: {
          id: 456,
          user: { login: 'reviewer1', id: 2 },
          state: 'changes_requested',
          body: 'Please fix these issues',
        },
        action: 'submitted',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
      vi.mocked(discord.removeReaction).mockResolvedValue();
      vi.mocked(discord.addReaction).mockResolvedValue();
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :eyes: Ready for Review',
      });
      vi.mocked(discord.editMessage).mockResolvedValue();

      await handlePRReview(context, mockCore, botToken, userMapping);

      expect(discord.addReaction).toHaveBeenCalledWith(
        botToken,
        'channel-123',
        'msg-123',
        '❌'
      );

      // 3. Review dismissed
      const { handleReviewDismissed } = await import(
        '../../.github/scripts/discord-pr-notifications/handlers/handle-review-dismissed'
      );

      context.payload = {
        ...context.payload,
        review: {
          ...context.payload.review,
          state: 'changes_requested',
        },
        action: 'dismissed',
      };

      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :tools: Changes Requested',
      });

      await handleReviewDismissed(context, mockCore, botToken, userMapping);

      expect(discord.editMessage).toHaveBeenCalledWith(
        botToken,
        'channel-123',
        'msg-123',
        expect.stringContaining(':eyes: Ready for Review')
      );

      // 4. PR merged
      context.payload = {
        ...context.payload,
        pull_request: {
          ...context.payload.pull_request,
          merged: true,
          merged_by: { login: 'merger', id: 3 },
          merge_commit_sha: 'abc123',
        },
        action: 'closed',
      };

      vi.mocked(discord.addReaction).mockResolvedValue();
      vi.mocked(discord.archiveThread).mockResolvedValue();
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Status**: :eyes: Ready for Review',
      });

      await handlePRMerged(context, mockCore, botToken, userMapping);

      expect(discord.archiveThread).toHaveBeenCalled();
    });
  });

  describe('Reviewer Management', () => {
    it('should handle reviewer addition and removal', async () => {
      const context = createMockGitHubContext();
      const reviewerUserMapping: UserMapping = {
        'test-author': 'author-discord-id',
        'reviewer1': 'reviewer1-discord-id',
        'reviewer2': 'reviewer2-discord-id',
        'reviewer3': 'reviewer3-discord-id',
      };

      // 1. PR opened with reviewers
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
          requested_reviewers: [
            { login: 'reviewer1', id: 2, type: 'User' },
            { login: 'reviewer2', id: 3, type: 'User' },
          ],
        },
        action: 'opened',
      };

      vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
      vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(github.saveMetadataToPR).mockResolvedValue();

      await handlePROpened(context, mockCore, botToken, channelId, reviewerUserMapping);

      // 2. Reviewer added
      context.payload = {
        ...context.payload,
        pull_request: {
          ...context.payload.pull_request,
          requested_reviewers: [
            { login: 'reviewer1', id: 2, type: 'User' },
            { login: 'reviewer2', id: 3, type: 'User' },
            { login: 'reviewer3', id: 4, type: 'User' },
          ],
        },
        requested_reviewer: { login: 'reviewer3', id: 4, type: 'User' },
        action: 'review_requested',
      };

      vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Reviewers:** @reviewer1 @reviewer2',
      });
      vi.mocked(discord.editMessage).mockResolvedValue();

      await handleReviewerAdded(context, mockCore, botToken, reviewerUserMapping);

      const editCall = vi.mocked(discord.editMessage).mock.calls[0];
      expect(editCall[3]).toContain('reviewer1');
      expect(editCall[3]).toContain('reviewer2');
      expect(editCall[3]).toContain('reviewer3');

      // 3. Reviewer removed
      const { handleReviewerRemoved } = await import(
        '../../.github/scripts/discord-pr-notifications/handlers/handle-reviewer-removed'
      );

      context.payload = {
        ...context.payload,
        pull_request: {
          ...context.payload.pull_request,
          requested_reviewers: [
            { login: 'reviewer1', id: 2, type: 'User' },
            { login: 'reviewer3', id: 4, type: 'User' },
          ],
        },
        requested_reviewer: { login: 'reviewer2', id: 3, type: 'User' },
        action: 'review_request_removed',
      };

      vi.mocked(discord.removeThreadMember).mockResolvedValue();
      vi.mocked(discord.sendThreadMessage).mockResolvedValue();
      vi.mocked(discord.getMessage).mockResolvedValue({
        id: 'msg-123',
        content: '**Reviewers:** @reviewer1 @reviewer2 @reviewer3',
      });
      vi.mocked(discord.editMessage).mockResolvedValue();

      await handleReviewerRemoved(context, mockCore, botToken, reviewerUserMapping);

      expect(discord.removeThreadMember).toHaveBeenCalled();
      const removeEditCall = vi.mocked(discord.editMessage).mock.calls[1];
      expect(removeEditCall[3]).not.toContain('reviewer2');
    });
  });
});
