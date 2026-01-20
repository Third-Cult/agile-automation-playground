import { vi } from 'vitest';

// Mock @actions/core
vi.mock('@actions/core', () => ({
  default: {
    setFailed: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock @actions/github
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(),
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));
