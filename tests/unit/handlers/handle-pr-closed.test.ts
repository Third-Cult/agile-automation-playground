import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePRClosed } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-pr-closed';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-pr-closed', () => {
  const botToken = 'test-bot-token';
  const userMapping: UserMapping = {
    'test-author': 'author-discord-id',
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

  it('should lock thread and update status when PR closed', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: '',
        draft: false,
        state: 'closed',
        merged: false,
        user: { login: 'test-author', id: 1 },
        base: { ref: 'main' },
        head: { ref: 'feature' },
        requested_reviewers: [],
      },
      action: 'closed',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(github.getPRComments).mockResolvedValue([]);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.lockThread).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :eyes: Ready for Review',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handlePRClosed(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('closed')
    );
    expect(discord.lockThread).toHaveBeenCalledWith(botToken, 'thread-123', true);
    expect(discord.editMessage).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      expect.stringContaining(':closed_book: Closed')
    );
  });

  it('should include closing comment if recent', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: '',
        draft: false,
        state: 'closed',
        merged: false,
        user: { login: 'test-author', id: 1 },
        base: { ref: 'main' },
        head: { ref: 'feature' },
        requested_reviewers: [],
      },
      action: 'closed',
    };

    const recentComment = {
      id: 1,
      body: 'Closing this PR',
      user: { login: 'test-author', id: 1 },
      created_at: new Date().toISOString(),
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(github.getPRComments).mockResolvedValue([recentComment]);
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(discord.lockThread).mockResolvedValue();
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :eyes: Ready for Review',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();

    await handlePRClosed(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('Closing this PR')
    );
  });
});
