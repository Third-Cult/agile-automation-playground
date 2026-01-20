import { vi } from 'vitest';
import type { HandlerContext } from '../../.github/scripts/discord-pr-notifications/types';
import type { RestEndpointMethods } from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/types';

export interface MockGitHubAPI {
  rest: Partial<RestEndpointMethods>;
}

export function createMockGitHubContext(
  overrides?: Partial<MockGitHubAPI>
): HandlerContext {
  const defaultMock: MockGitHubAPI = {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: [] }),
        createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      },
      pulls: {
        getReview: vi.fn().mockResolvedValue({
          data: { id: 1, body: 'Test review body' },
        }),
        requestReviewers: vi.fn().mockResolvedValue({ data: {} }),
      },
      repos: {
        getCommit: vi.fn().mockResolvedValue({
          data: {
            commit: {
              message: 'Merge pull request #123\n\nTest merge commit',
            },
          },
        }),
      },
    },
  };

  const mockAPI = { ...defaultMock, ...overrides };

  return {
    github: mockAPI as any,
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    payload: {} as any,
  };
}

export function createMockOctokit(overrides?: Partial<MockGitHubAPI>) {
  const context = createMockGitHubContext(overrides);
  return {
    rest: context.github.rest,
  };
}
