import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePRSynchronize } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-pr-synchronize';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-pr-synchronize', () => {
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

  it('should unlock thread and reset status when previously approved', async () => {
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
      action: 'synchronize',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :white_check_mark: Approved by @reviewer1',
    });
    vi.mocked(discord.lockThread).mockResolvedValue();
    vi.mocked(discord.editMessage).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();
    vi.mocked(github.requestReviewers).mockResolvedValue();

    await handlePRSynchronize(context, mockCore, botToken, userMapping);

    expect(discord.lockThread).toHaveBeenCalledWith(botToken, 'thread-123', false);
    expect(discord.editMessage).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      expect.stringContaining(':eyes: Ready for Review')
    );
    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('New commits have been pushed')
    );
    expect(github.requestReviewers).toHaveBeenCalled();
  });

  it('should not process when not previously approved', async () => {
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
      action: 'synchronize',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :eyes: Ready for Review',
    });

    await handlePRSynchronize(context, mockCore, botToken, userMapping);

    expect(discord.lockThread).not.toHaveBeenCalled();
    expect(discord.editMessage).not.toHaveBeenCalled();
  });

  it('should handle no reviewers case', async () => {
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
      action: 'synchronize',
    };

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :white_check_mark: Approved',
    });
    vi.mocked(discord.lockThread).mockResolvedValue();
    vi.mocked(discord.editMessage).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();

    await handlePRSynchronize(context, mockCore, botToken, userMapping);

    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('Please add reviewers if needed')
    );
    expect(github.requestReviewers).not.toHaveBeenCalled();
  });
});
