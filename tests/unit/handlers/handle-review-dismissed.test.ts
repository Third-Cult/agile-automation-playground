import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReviewDismissed } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-review-dismissed';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-review-dismissed', () => {
  const botToken = 'test-bot-token';
  const userMapping: UserMapping = {
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

  it('should handle dismissed changes_requested review', async () => {
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
        body: 'Please fix',
      },
      action: 'dismissed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :tools: Changes Requested',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handleReviewDismissed(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('addressed')
    );
    expect(discord.editMessage).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      expect.stringContaining(':eyes: Ready for Review')
    );
  });

  it('should skip dismissed approved review', async () => {
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
      action: 'dismissed',
    };

    await handleReviewDismissed(context, mockCore, botToken, userMapping);

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('not changes_requested')
    );
    expect(discord.sendThreadMessage).not.toHaveBeenCalled();
  });
});
