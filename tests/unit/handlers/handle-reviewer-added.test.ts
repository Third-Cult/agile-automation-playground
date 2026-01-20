import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReviewerAdded } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-reviewer-added';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-reviewer-added', () => {
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

  it('should mention reviewer and update parent message', async () => {
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
        requested_reviewers: [
          { login: 'reviewer1', id: 2, type: 'User' },
          { login: 'reviewer2', id: 3, type: 'User' },
        ],
      },
      requested_reviewer: { login: 'reviewer2', id: 3, type: 'User' },
      action: 'review_requested',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Reviewers:** @reviewer1',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handleReviewerAdded(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('reviewer2')
    );
    expect(discord.editMessage).toHaveBeenCalled();
  });

  it('should update with all current reviewers', async () => {
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
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Reviewers:** @reviewer1 @reviewer2',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handleReviewerAdded(context, mockCore, botToken, userMapping);

    const editCall = vi.mocked(discord.editMessage).mock.calls[0];
    expect(editCall[3]).toContain('reviewer1');
    expect(editCall[3]).toContain('reviewer2');
    expect(editCall[3]).toContain('reviewer3');
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
      requested_reviewer: { login: 'reviewer1', id: 2, type: 'User' },
      action: 'review_requested',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(null);
    vi.mocked(github.postMetadataMissingComment).mockResolvedValue();

    await handleReviewerAdded(context, mockCore, botToken, userMapping);

    expect(mockCore.warning).toHaveBeenCalled();
    expect(github.postMetadataMissingComment).toHaveBeenCalled();
  });
});
