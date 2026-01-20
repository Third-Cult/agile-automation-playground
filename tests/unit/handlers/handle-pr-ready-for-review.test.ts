import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePRReadyForReview } from '../../../.github/scripts/discord-pr-notifications/handlers/handle-pr-ready-for-review';
import { createMockGitHubContext } from '../../mocks/github';
import * as discord from '../../../.github/scripts/discord-pr-notifications/utils/discord';
import * as github from '../../../.github/scripts/discord-pr-notifications/utils/github';
import { createMetadataComment } from '../../../.github/scripts/discord-pr-notifications/utils/metadata';
import type { Core, UserMapping, DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

vi.mock('../../../.github/scripts/discord-pr-notifications/utils/discord');
vi.mock('../../../.github/scripts/discord-pr-notifications/utils/github');

describe('handle-pr-ready-for-review', () => {
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

  it('should update status from Draft to Ready', async () => {
    const metadata: DiscordMetadata = {
      message_id: 'msg-123',
      thread_id: 'thread-123',
      channel_id: 'channel-123',
    };

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

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
    vi.mocked(discord.getMessage).mockResolvedValue({
      id: 'msg-123',
      content: '**Status**: :pencil: Draft - In Progress',
    });
    vi.mocked(discord.editMessage).mockResolvedValue();
    vi.mocked(discord.sendThreadMessage).mockResolvedValue();

    await handlePRReadyForReview(context, mockCore, botToken, userMapping);

    expect(discord.editMessage).toHaveBeenCalledWith(
      botToken,
      'channel-123',
      'msg-123',
      expect.stringContaining(':eyes: Ready for Review')
    );
    expect(discord.sendThreadMessage).toHaveBeenCalledWith(
      botToken,
      'thread-123',
      expect.stringContaining('ready for review')
    );
  });

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
    expect(github.postMetadataMissingComment).toHaveBeenCalled();
  });

  it('should fail when bot token missing', async () => {
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

    await handlePRReadyForReview(context, mockCore, '', userMapping);

    expect(mockCore.setFailed).toHaveBeenCalled();
  });

  it('should handle edit message failure gracefully', async () => {
    const metadata: DiscordMetadata = {
      message_id: 'msg-123',
      thread_id: 'thread-123',
      channel_id: 'channel-123',
    };

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

    vi.mocked(github.getMetadataFromPR).mockResolvedValue(metadata);
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
  });
});
