import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePROpened } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-pr-opened';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-pr-opened', () => {
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

  it('should handle draft PR with reviewers', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: 'Test description',
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
    expect(discord.createThread).toHaveBeenCalled();
    expect(github.saveMetadataToPR).toHaveBeenCalled();
  });

  it('should handle ready PR without reviewers', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: 'Test description',
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

    expect(discord.sendMessage).toHaveBeenCalledWith(
      botToken,
      channelId,
      expect.stringContaining('WARNING::No reviewers assigned')
    );
  });

  it('should fail when bot token is missing', async () => {
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

    await handlePROpened(context, mockCore, '', channelId, userMapping);

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('DISCORD_BOT_TOKEN')
    );
  });

  it('should fail when channel ID is missing', async () => {
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

    await handlePROpened(context, mockCore, botToken, '', userMapping);

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('DISCORD_CHANNEL_ID')
    );
  });

  it('should warn but not fail when thread creation fails', async () => {
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

    await handlePROpened(context, mockCore, botToken, channelId, userMapping);

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create thread')
    );
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  it('should handle very long PR title (truncation)', async () => {
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

    expect(discord.createThread).toHaveBeenCalledWith(
      botToken,
      channelId,
      'msg-123',
      expect.stringMatching(/^PR #123: A+/)
    );
    const threadName = vi.mocked(discord.createThread).mock.calls[0][3];
    expect(threadName.length).toBeLessThanOrEqual(100);
  });

  it('should handle PR with no description', async () => {
    const context = createMockGitHubContext();
    context.payload = {
      pull_request: {
        number: 123,
        title: 'Test PR',
        html_url: 'https://github.com/test/repo/pull/123',
        body: null,
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

    expect(discord.sendMessage).toHaveBeenCalled();
    const message = vi.mocked(discord.sendMessage).mock.calls[0][2];
    expect(message).not.toContain('null');
  });

  it('should handle multiple reviewers', async () => {
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
      action: 'opened',
    };

    vi.mocked(discord.sendMessage).mockResolvedValue({ id: 'msg-123' });
    vi.mocked(discord.createThread).mockResolvedValue({ id: 'thread-123' });
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(github.saveMetadataToPR).mockResolvedValue();

    await handlePROpened(context, mockCore, botToken, channelId, userMapping);

    const message = vi.mocked(discord.sendMessage).mock.calls[0][2];
    expect(message).toContain('reviewer1');
    expect(message).toContain('reviewer2');
    expect(message).toContain('reviewer3');
  });
});
