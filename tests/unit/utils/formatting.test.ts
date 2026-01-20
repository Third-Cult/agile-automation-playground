import { describe, it, expect } from 'vitest';
import {
  mapToDiscord,
  buildPRMessage,
  updateReviewersLine,
  replaceStatusLine,
  updateStatusLine,
} from '../../../.github/scripts/discord-pr-notifications/utils/formatting';
import type { UserMapping } from '../../../.github/scripts/discord-pr-notifications/types';

describe('formatting', () => {
  describe('mapToDiscord', () => {
    it('should return Discord mention when user exists in mapping', () => {
      const userMapping: UserMapping = {
        'test-user': '123456789',
      };
      expect(mapToDiscord('test-user', userMapping)).toBe('<@123456789>');
    });

    it('should return GitHub username when user not in mapping', () => {
      const userMapping: UserMapping = {};
      expect(mapToDiscord('test-user', userMapping)).toBe('@test-user');
    });

    it('should handle empty mapping object', () => {
      const userMapping: UserMapping = {};
      expect(mapToDiscord('unknown-user', userMapping)).toBe('@unknown-user');
    });

    it('should handle special characters in usernames', () => {
      const userMapping: UserMapping = {
        'user-name': '123456789',
      };
      expect(mapToDiscord('user-name', userMapping)).toBe('<@123456789>');
      expect(mapToDiscord('user_name', userMapping)).toBe('@user_name');
    });
  });

  describe('buildPRMessage', () => {
    const baseParams = {
      prNumber: 123,
      prTitle: 'Test PR',
      prUrl: 'https://github.com/test/repo/pull/123',
      headBranch: 'feature-branch',
      baseBranch: 'main',
      author: 'test-author',
      prDescription: 'Test description',
      reviewerLogins: ['reviewer1'],
      isDraft: false,
      userMapping: {},
    };

    it('should build message for draft PR with reviewers', () => {
      const message = buildPRMessage({
        ...baseParams,
        isDraft: true,
        reviewerLogins: ['reviewer1', 'reviewer2'],
      });

      expect(message).toContain('PR #123: Test PR');
      expect(message).toContain('feature-branch');
      expect(message).toContain('main');
      expect(message).toContain('@test-author');
      expect(message).toContain('Test description');
      expect(message).toContain('Reviewers:');
      expect(message).toContain('@reviewer1');
      expect(message).toContain('@reviewer2');
      expect(message).toContain('**Status**: :pencil: Draft - In Progress');
    });

    it('should build message for draft PR without reviewers', () => {
      const message = buildPRMessage({
        ...baseParams,
        isDraft: true,
        reviewerLogins: [],
      });

      expect(message).toContain('WARNING::No reviewers assigned');
      expect(message).toContain('PR has to be reviewed');
      expect(message).toContain('**Status**: :pencil: Draft - In Progress');
    });

    it('should build message for ready PR with reviewers', () => {
      const message = buildPRMessage({
        ...baseParams,
        isDraft: false,
        reviewerLogins: ['reviewer1'],
      });

      expect(message).toContain('**Status**: :eyes: Ready for Review');
      expect(message).toContain('Reviewers:');
    });

    it('should build message for ready PR without reviewers', () => {
      const message = buildPRMessage({
        ...baseParams,
        isDraft: false,
        reviewerLogins: [],
      });

      expect(message).toContain('WARNING::No reviewers assigned');
      expect(message).toContain('**Status**: :eyes: Ready for Review');
    });

    it('should handle PR with description', () => {
      const message = buildPRMessage({
        ...baseParams,
        prDescription: 'Detailed PR description\n\nWith multiple lines',
      });

      expect(message).toContain('Detailed PR description');
      expect(message).toContain('With multiple lines');
    });

    it('should handle PR without description', () => {
      const message = buildPRMessage({
        ...baseParams,
        prDescription: '',
      });

      expect(message).not.toContain('Test description');
    });

    it('should handle empty description', () => {
      const message = buildPRMessage({
        ...baseParams,
        prDescription: '   ',
      });

      expect(message).not.toContain('   ');
    });

    it('should handle multiple reviewers', () => {
      const message = buildPRMessage({
        ...baseParams,
        reviewerLogins: ['reviewer1', 'reviewer2', 'reviewer3'],
      });

      expect(message).toContain('@reviewer1');
      expect(message).toContain('@reviewer2');
      expect(message).toContain('@reviewer3');
    });

    it('should apply user mapping correctly', () => {
      const userMapping: UserMapping = {
        'test-author': 'author-discord-id',
        'reviewer1': 'reviewer1-discord-id',
      };

      const message = buildPRMessage({
        ...baseParams,
        userMapping,
      });

      expect(message).toContain('<@author-discord-id>');
      expect(message).toContain('<@reviewer1-discord-id>');
    });
  });

  describe('updateReviewersLine', () => {
    const baseContent = `## [PR #123: Test PR](url)
# \`feature\` -> \`main\`

**Author:** @author

**Reviewers:** @reviewer1 @reviewer2

**Status**: :eyes: Ready for Review`;

    it('should update reviewers when adding to empty list', () => {
      const content = `## [PR #123: Test PR](url)
**Author:** @author

WARNING::No reviewers assigned:

**Status**: :eyes: Ready for Review`;

      const updated = updateReviewersLine(content, ['reviewer1'], {});

      expect(updated).toContain('**Reviewers:** @reviewer1');
      expect(updated).not.toContain('WARNING::No reviewers assigned');
    });

    it('should show warning when removing all reviewers', () => {
      const updated = updateReviewersLine(baseContent, [], {});

      expect(updated).toContain('WARNING::No reviewers assigned');
      expect(updated).toContain('PR has to be reviewed');
    });

    it('should update existing reviewers', () => {
      const updated = updateReviewersLine(baseContent, ['reviewer1', 'reviewer3'], {});

      expect(updated).toContain('**Reviewers:** @reviewer1 @reviewer3');
      expect(updated).not.toContain('@reviewer2');
    });

    it('should find Author line when reviewers line missing', () => {
      const content = `## [PR #123: Test PR](url)
**Author:** @author

**Status**: :eyes: Ready for Review`;

      const updated = updateReviewersLine(content, ['reviewer1'], {});

      expect(updated).toContain('**Author:** @author');
      expect(updated).toContain('**Reviewers:** @reviewer1');
    });

    it('should handle ANSI warning format', () => {
      const content = `## [PR #123: Test PR](url)
**Author:** @author

\u001b[2;33mWARNING::No reviewers assigned:\u001b[0m
PR has to be reviewed

**Status**: :eyes: Ready for Review`;

      const updated = updateReviewersLine(content, ['reviewer1'], {});

      expect(updated).toContain('**Reviewers:** @reviewer1');
      expect(updated).not.toContain('WARNING::No reviewers assigned');
    });

    it('should apply user mapping', () => {
      const userMapping: UserMapping = {
        reviewer1: 'discord-id-1',
        reviewer2: 'discord-id-2',
      };

      const updated = updateReviewersLine(baseContent, ['reviewer1', 'reviewer2'], userMapping);

      expect(updated).toContain('<@discord-id-1>');
      expect(updated).toContain('<@discord-id-2>');
    });
  });

  describe('replaceStatusLine', () => {
    it('should replace existing status line', () => {
      const content = `## PR
**Status**: :eyes: Ready for Review`;

      const updated = replaceStatusLine(content, ':white_check_mark: Approved');

      expect(updated).toContain('**Status**: :white_check_mark: Approved');
      expect(updated).not.toContain('Ready for Review');
    });

    it('should handle multiple status lines (edge case)', () => {
      const content = `**Status**: Old Status
**Status**: Another Status`;

      const updated = replaceStatusLine(content, 'New Status');

      expect(updated).toContain('**Status**: New Status');
      // Regex replace should replace all occurrences
      const matches = updated.match(/\*\*Status\*\*:/g);
      expect(matches?.length).toBe(2);
    });

    it('should handle status line with special characters', () => {
      const content = `**Status**: :white_check_mark: Approved by @user`;

      const updated = replaceStatusLine(content, ':tools: Changes Requested');

      expect(updated).toContain('**Status**: :tools: Changes Requested');
    });
  });

  describe('updateStatusLine', () => {
    it('should replace existing status line', () => {
      const content = `## PR
**Reviewers:** @reviewer1
**Status**: :eyes: Ready for Review`;

      const updated = updateStatusLine(content, ':white_check_mark: Approved');

      expect(updated).toContain('**Status**: :white_check_mark: Approved');
      expect(updated).not.toContain('Ready for Review');
    });

    it('should add status line after Reviewers when missing', () => {
      const content = `## PR
**Reviewers:** @reviewer1

Some other content`;

      const updated = updateStatusLine(content, ':eyes: Ready for Review');

      const lines = updated.split('\n');
      const reviewersIndex = lines.findIndex((line) => line.includes('Reviewers:'));
      const statusIndex = lines.findIndex((line) => line.includes('**Status**:'));

      expect(statusIndex).toBeGreaterThan(reviewersIndex);
      expect(updated).toContain('**Status**: :eyes: Ready for Review');
    });

    it('should append to end when no Reviewers line', () => {
      const content = `## PR
**Author:** @author`;

      const updated = updateStatusLine(content, ':eyes: Ready for Review');

      expect(updated).toContain('**Status**: :eyes: Ready for Review');
      expect(updated.endsWith('**Status**: :eyes: Ready for Review')).toBe(true);
    });

    it('should handle ANSI warning format for Reviewers', () => {
      const content = `## PR
WARNING::No reviewers assigned:

Some content`;

      const updated = updateStatusLine(content, ':eyes: Ready for Review');

      const lines = updated.split('\n');
      const warningIndex = lines.findIndex((line) => line.includes('WARNING'));
      const statusIndex = lines.findIndex((line) => line.includes('**Status**:'));

      expect(statusIndex).toBeGreaterThan(warningIndex);
    });
  });
});
