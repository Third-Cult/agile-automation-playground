import type { HandlerContext, GitHubComment, DiscordMetadata } from '../types';
import { findMetadata, createMetadataComment } from './metadata';

/**
 * Get all comments for a PR
 */
export async function getPRComments(
  context: HandlerContext,
  prNumber: number
): Promise<GitHubComment[]> {
  const comments = await context.github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
  });
  return comments.data;
}

/**
 * Get Discord metadata from PR comments
 */
export async function getMetadataFromPR(
  context: HandlerContext,
  prNumber: number
): Promise<DiscordMetadata | null> {
  const comments = await getPRComments(context, prNumber);
  return findMetadata(comments);
}

/**
 * Save metadata to PR as a hidden comment
 */
export async function saveMetadataToPR(
  context: HandlerContext,
  prNumber: number,
  metadata: DiscordMetadata
): Promise<void> {
  const commentBody = createMetadataComment(metadata);
  await context.github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    body: commentBody,
  });
}

/**
 * Get full review details if body is empty
 */
export async function getReviewDetails(
  context: HandlerContext,
  prNumber: number,
  reviewId: number
): Promise<string> {
  try {
    const fullReview = await context.github.rest.pulls.getReview({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
      review_id: reviewId,
    });
    return fullReview.data.body || '';
  } catch (e) {
    throw new Error(`Could not fetch review details: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Re-request reviews on GitHub
 */
export async function requestReviewers(
  context: HandlerContext,
  prNumber: number,
  reviewerLogins: string[]
): Promise<void> {
  if (reviewerLogins.length === 0) {
    return;
  }

  try {
    await context.github.rest.pulls.requestReviewers({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
      reviewers: reviewerLogins,
    });
  } catch (e) {
    throw new Error(`Failed to re-request reviews: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Post a warning comment in PR when metadata is missing
 */
export async function postMetadataMissingComment(
  context: HandlerContext,
  prNumber: number
): Promise<void> {
  try {
    await context.github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: '⚠️ Discord integration: Could not find Discord thread metadata for this PR. The Discord bot may not be able to update notifications.',
    });
  } catch (e) {
    // If we can't comment, that's okay - just log it
    throw new Error(`Failed to comment in PR: ${e instanceof Error ? e.message : String(e)}`);
  }
}
