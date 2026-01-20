import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPRComments,
  getMetadataFromPR,
  saveMetadataToPR,
  getReviewDetails,
  requestReviewers,
  postMetadataMissingComment,
} from '../../../.github/scripts/discord-pr-notifications/utils/github';
import { createMetadataComment } from '../../../.github/scripts/discord-pr-notifications/utils/metadata';
import { createMockGitHubContext } from '../../mocks/github';
import type { DiscordMetadata } from '../../../.github/scripts/discord-pr-notifications/types';

describe('github', () => {
  const prNumber = 123;

  describe('getPRComments', () => {
    it('should retrieve comments successfully', async () => {
      const mockComments = [
        {
          id: 1,
          body: 'Comment 1',
          user: { login: 'user1', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'Comment 2',
          user: { login: 'user2', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const context = createMockGitHubContext({
        rest: {
          issues: {
            listComments: vi.fn().mockResolvedValue({ data: mockComments }),
          } as any,
        },
      });

      const comments = await getPRComments(context, prNumber);

      expect(comments).toEqual(mockComments);
      expect(context.github.rest.issues?.listComments).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: prNumber,
      });
    });

    it('should return empty array when no comments', async () => {
      const context = createMockGitHubContext({
        rest: {
          issues: {
            listComments: vi.fn().mockResolvedValue({ data: [] }),
          } as any,
        },
      });

      const comments = await getPRComments(context, prNumber);

      expect(comments).toEqual([]);
    });

    it('should handle API errors', async () => {
      const context = createMockGitHubContext({
        rest: {
          issues: {
            listComments: vi.fn().mockRejectedValue(new Error('API Error')),
          } as any,
        },
      });

      await expect(getPRComments(context, prNumber)).rejects.toThrow('API Error');
    });
  });

  describe('getMetadataFromPR', () => {
    it('should find metadata in comments', async () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comments = [
        {
          id: 1,
          body: 'Regular comment',
          user: { login: 'user1', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: createMetadataComment(metadata),
          user: { login: 'bot', id: 2 },
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const context = createMockGitHubContext({
        rest: {
          issues: {
            listComments: vi.fn().mockResolvedValue({ data: comments }),
          } as any,
        },
      });

      const found = await getMetadataFromPR(context, prNumber);

      expect(found).toEqual(metadata);
    });

    it('should return null when no metadata found', async () => {
      const comments = [
        {
          id: 1,
          body: 'Regular comment',
          user: { login: 'user1', id: 1 },
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const context = createMockGitHubContext({
        rest: {
          issues: {
            listComments: vi.fn().mockResolvedValue({ data: comments }),
          } as any,
        },
      });

      const found = await getMetadataFromPR(context, prNumber);

      expect(found).toBeNull();
    });

    it('should find metadata when multiple comments exist', async () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const comments = [
        { id: 1, body: 'Comment 1', user: { login: 'user1', id: 1 }, created_at: '2024-01-01T00:00:00Z' },
        { id: 2, body: 'Comment 2', user: { login: 'user2', id: 2 }, created_at: '2024-01-02T00:00:00Z' },
        {
          id: 3,
          body: createMetadataComment(metadata),
          user: { login: 'bot', id: 3 },
          created_at: '2024-01-03T00:00:00Z',
        },
        { id: 4, body: 'Comment 4', user: { login: 'user3', id: 4 }, created_at: '2024-01-04T00:00:00Z' },
      ];

      const context = createMockGitHubContext({
        rest: {
          issues: {
            listComments: vi.fn().mockResolvedValue({ data: comments }),
          } as any,
        },
      });

      const found = await getMetadataFromPR(context, prNumber);

      expect(found).toEqual(metadata);
    });
  });

  describe('saveMetadataToPR', () => {
    it('should save metadata successfully', async () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const mockCreateComment = vi.fn().mockResolvedValue({ data: { id: 1 } });

      const context = createMockGitHubContext({
        rest: {
          issues: {
            createComment: mockCreateComment,
          } as any,
        },
      });

      await saveMetadataToPR(context, prNumber, metadata);

      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: prNumber,
        body: expect.stringContaining('DISCORD_BOT_METADATA'),
      });
    });

    it('should handle API errors', async () => {
      const metadata: DiscordMetadata = {
        message_id: 'msg-123',
        thread_id: 'thread-123',
        channel_id: 'channel-123',
      };

      const context = createMockGitHubContext({
        rest: {
          issues: {
            createComment: vi.fn().mockRejectedValue(new Error('API Error')),
          } as any,
        },
      });

      await expect(saveMetadataToPR(context, prNumber, metadata)).rejects.toThrow('API Error');
    });
  });

  describe('getReviewDetails', () => {
    it('should fetch review details successfully', async () => {
      const reviewId = 456;
      const reviewBody = 'Detailed review body';

      const context = createMockGitHubContext({
        rest: {
          pulls: {
            getReview: vi.fn().mockResolvedValue({
              data: { id: reviewId, body: reviewBody },
            }),
          } as any,
        },
      });

      const body = await getReviewDetails(context, prNumber, reviewId);

      expect(body).toBe(reviewBody);
      expect(context.github.rest.pulls?.getReview).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: prNumber,
        review_id: reviewId,
      });
    });

    it('should return empty string when review not found', async () => {
      const reviewId = 456;

      const context = createMockGitHubContext({
        rest: {
          pulls: {
            getReview: vi.fn().mockRejectedValue(new Error('Review not found')),
          } as any,
        },
      });

      await expect(getReviewDetails(context, prNumber, reviewId)).rejects.toThrow();
    });

    it('should return empty string when review body is null', async () => {
      const reviewId = 456;

      const context = createMockGitHubContext({
        rest: {
          pulls: {
            getReview: vi.fn().mockResolvedValue({
              data: { id: reviewId, body: null },
            }),
          } as any,
        },
      });

      const body = await getReviewDetails(context, prNumber, reviewId);

      expect(body).toBe('');
    });
  });

  describe('requestReviewers', () => {
    it('should request reviewers successfully', async () => {
      const reviewerLogins = ['reviewer1', 'reviewer2'];

      const mockRequestReviewers = vi.fn().mockResolvedValue({ data: {} });

      const context = createMockGitHubContext({
        rest: {
          pulls: {
            requestReviewers: mockRequestReviewers,
          } as any,
        },
      });

      await requestReviewers(context, prNumber, reviewerLogins);

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: prNumber,
        reviewers: reviewerLogins,
      });
    });

    it('should not call API when reviewers list is empty', async () => {
      const mockRequestReviewers = vi.fn();

      const context = createMockGitHubContext({
        rest: {
          pulls: {
            requestReviewers: mockRequestReviewers,
          } as any,
        },
      });

      await requestReviewers(context, prNumber, []);

      expect(mockRequestReviewers).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      const reviewerLogins = ['reviewer1'];

      const context = createMockGitHubContext({
        rest: {
          pulls: {
            requestReviewers: vi.fn().mockRejectedValue(new Error('API Error')),
          } as any,
        },
      });

      await expect(requestReviewers(context, prNumber, reviewerLogins)).rejects.toThrow('API Error');
    });
  });

  describe('postMetadataMissingComment', () => {
    it('should post warning comment successfully', async () => {
      const mockCreateComment = vi.fn().mockResolvedValue({ data: { id: 1 } });

      const context = createMockGitHubContext({
        rest: {
          issues: {
            createComment: mockCreateComment,
          } as any,
        },
      });

      await postMetadataMissingComment(context, prNumber);

      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: prNumber,
        body: expect.stringContaining('Discord integration'),
      });
    });

    it('should handle API errors gracefully', async () => {
      const context = createMockGitHubContext({
        rest: {
          issues: {
            createComment: vi.fn().mockRejectedValue(new Error('API Error')),
          } as any,
        },
      });

      await expect(postMetadataMissingComment(context, prNumber)).rejects.toThrow('API Error');
    });
  });
});
