import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePRMerged } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-pr-merged';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-pr-merged', () => {
  const botToken = 'test-bot-token';
  const userMapping: UserMapping = {
    'test-author': 'author-discord-id',
    'merger': 'merger-discord-id',
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

  it('should archive thread and update status when PR merged', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: '',
        draft: false,
        state: 'closed',
        merged: true,
        merged_by: { login: 'merger', id: 2 },
        merge_commit_sha: 'abc123',
        user: { login: 'test-author', id: 1 },
        base: { ref: 'main' },
        head: { ref: 'feature' },
        requested_reviewers: [],
      },
      action: 'closed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.addReaction).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.archiveThread).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :white_check_mark: Approved',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handlePRMerged(context, mockCore, botToken, userMapping);

    expect(discord.addReaction).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      '🎉'
    );
    expect(discord.archiveThread).toHaveBeenCalledWith(botToken, 'thread-123');
    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('merged')
    );
    expect(discord.editMessage).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      expect.stringContaining(':tada: Merged')
    );
  });

  it('should include merge commit message', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: '',
        draft: false,
        state: 'closed',
        merged: true,
        merged_by: { login: 'merger', id: 2 },
        merge_commit_sha: 'abc123',
        user: { login: 'test-author', id: 1 },
        base: { ref: 'main' },
        head: { ref: 'feature' },
        requested_reviewers: [],
      },
      action: 'closed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.addReaction).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.archiveThread).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :white_check_mark: Approved',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handlePRMerged(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('Merge pull request')
    );
  });

  it('should handle missing merge commit SHA', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: '',
        draft: false,
        state: 'closed',
        merged: true,
        merged_by: { login: 'merger', id: 2 },
        merge_commit_sha: null,
        user: { login: 'test-author', id: 1 },
        base: { ref: 'main' },
        head: { ref: 'feature' },
        requested_reviewers: [],
      },
      action: 'closed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.addReaction).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.archiveThread).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :white_check_mark: Approved',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handlePRMerged(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalled();
    const message = vi.mocked(discord.sendThreadMessage).mock.calls[0][2];
    expect(message).not.toContain('> Merge');
  });
});
