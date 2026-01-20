import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePRReview } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-pr-review';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-pr-review', () => {
  const botToken = 'test-bot-token';
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

  const metadata: DiscordMetadata = {
    message_id: 'msg-123',
    thread_id: 'thread-123',
    channel_id: 'channel-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle approved review', async () => {
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
        body: 'Looks good!',
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

    expect(discord.removeReaction).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      '❌'
    );
    expect(discord.addReaction).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      '✅'
    );
    expect(discord.lockThread).toHaveBeenCalledWith(botToken, 'thread-123', true);
    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('approved')
    );
  });

  it('should handle changes requested review', async () => {
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
        state: 'changes_requested',
        body: 'Please fix these issues',
      },
      action: 'submitted',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.removeReaction).mockResolvedValue();
    vi.mocked(discord.addReaction).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
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
    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('changes have been requested')
    );
  });

  it('should skip commented reviews', async () => {
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
        state: 'commented',
        body: 'Just a comment',
      },
      action: 'submitted',
    };

    await handlePRReview(context, mockCore, botToken, userMapping);

    expect(mockCore.info).toHaveBeenCalledWith('Review is just a comment, skipping.');
    expect(discord.addReaction).not.toHaveBeenCalled();
    expect(discord.sendThreadMessage).not.toHaveBeenCalled();
  });

  it('should fetch review body when empty in payload', async () => {
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
        body: '',
      },
      action: 'submitted',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(github.getReviewDetails).mockResolvedValue('Fetched review body');
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

    expect(github.getReviewDetails).toHaveBeenCalledWith(context, 123, 456);
    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('Fetched review body')
    );
  });

  it('should handle missing review in payload', async () => {
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
      action: 'submitted',
    };

    await handlePRReview(context, mockCore, botToken, userMapping);

    expect(mockCore.warning).toHaveBeenCalledWith('No review found in payload');
  });

  it('should handle missing metadata', async () => {
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
        body: 'Looks good',
      },
      action: 'submitted',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(null);
    vi.mocked(github.postMetadataMissingComment).mockResolvedValue();

    await handlePRReview(context, mockCore, botToken, userMapping);

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('No Discord metadata found')
    );
    expect(github.postMetadataMissingComment).toHaveBeenCalled();
  });
});
