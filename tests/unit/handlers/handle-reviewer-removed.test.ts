import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReviewerRemoved } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-reviewer-removed';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-reviewer-removed', () => {
  const botToken = 'test-bot-token';
  const userMapping: UserMapping = {
    'reviewer1': 'reviewer1-discord-id',
    'reviewer2': 'reviewer2-discord-id',
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

  it('should remove reviewer from thread and update message', async () => {
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
        requested_reviewers: [{ login: 'reviewer1', id: 2, type: 'User' }],
      },
      requested_reviewer: { login: 'reviewer2', id: 3, type: 'User' },
      action: 'review_request_removed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.removeThreadMember).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Reviewers:** @reviewer1 @reviewer2',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handleReviewerRemoved(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('reviewer2')
    );
    expect(discord.removeThreadMember).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      'reviewer2-discord-id'
    );
    expect(discord.editMessage).toHaveBeenCalled();
  });

  it('should handle 404 when user not in thread', async () => {
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
      requested_reviewer: { login: 'reviewer2', id: 3, type: 'User' },
      action: 'review_request_removed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.removeThreadMember).mockRejectedValue(
      new Error('404: User not in thread')
    );
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Reviewers:**',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handleReviewerRemoved(context, mockCore, botToken, userMapping);

    expect(mockCore.warning).not.toHaveBeenCalled();
  });

  it('should warn on non-404 errors', async () => {
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
      requested_reviewer: { login: 'reviewer2', id: 3, type: 'User' },
      action: 'review_request_removed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.removeThreadMember).mockRejectedValue(
      new Error('500: Server error')
    );
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Reviewers:**',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handleReviewerRemoved(context, mockCore, botToken, userMapping);

    expect(mockCore.warning).toHaveBeenCalled();
  });
});
