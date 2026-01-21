import { Octokit } from '@octokit/rest';
import type { E2EConfig } from '../config';

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  draft: boolean;
  state: string;
  merged?: boolean;
}

export interface ReviewInfo {
  id: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  body?: string;
  user: {
    login: string;
  };
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: E2EConfig) {
    this.octokit = new Octokit({ auth: config.github.token });
    this.owner = config.github.owner;
    this.repo = config.github.repo;
  }

  /**
   * Get the default branch (usually 'main' or 'master')
   */
  async getDefaultBranch(): Promise<string> {
    const { data } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return data.default_branch;
  }

  /**
   * Get the latest commit SHA from a branch
   */
  async getBranchSha(branch: string): Promise<string> {
    const { data } = await this.octokit.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch,
    });
    return data.commit.sha;
  }

  /**
   * Create a new branch from the default branch
   */
  async createBranch(branchName: string, fromBranch?: string): Promise<string> {
    const baseBranch = fromBranch || (await this.getDefaultBranch());
    const baseSha = await this.getBranchSha(baseBranch);

    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    return baseSha;
  }

  /**
   * Create a commit on a branch
   */
  async createCommit(
    branch: string,
    message: string,
    content: string,
    path: string = 'test-file.txt'
  ): Promise<string> {
    // Get current file content if it exists
    let currentSha: string | undefined;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: branch,
      });
      if (!Array.isArray(data) && 'sha' in data) {
        currentSha = data.sha;
      }
    } catch (error) {
      // File doesn't exist, that's fine
    }

    const branchSha = await this.getBranchSha(branch);

    // Create or update file
    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha: currentSha,
    });

    // Get new commit SHA
    return await this.getBranchSha(branch);
  }

  /**
   * Create a pull request
   */
  async createPR(
    title: string,
    head: string,
    base: string,
    body?: string,
    draft: boolean = false,
    reviewers?: string[]
  ): Promise<PRInfo> {
    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      head,
      base,
      body: body || '',
      draft,
    });

    // Request reviewers if provided
    if (reviewers && reviewers.length > 0) {
      await this.requestReviewers(data.number, reviewers);
    }

    return {
      number: data.number,
      title: data.title,
      url: data.html_url,
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      base: {
        ref: data.base.ref,
      },
      draft: data.draft,
      state: data.state,
    };
  }

  /**
   * Update a pull request
   */
  async updatePR(
    prNumber: number,
    updates: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      draft?: boolean;
    }
  ): Promise<PRInfo> {
    const { data } = await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      ...updates,
    });

    return {
      number: data.number,
      title: data.title,
      url: data.html_url,
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      base: {
        ref: data.base.ref,
      },
      draft: data.draft,
      state: data.state,
    };
  }

  /**
   * Mark a draft PR as ready for review
   */
  async markReadyForReview(prNumber: number): Promise<PRInfo> {
    return this.updatePR(prNumber, { draft: false });
  }

  /**
   * Request reviewers for a PR
   */
  async requestReviewers(prNumber: number, reviewers: string[]): Promise<void> {
    await this.octokit.pulls.requestReviewers({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      reviewers,
    });
  }

  /**
   * Remove a reviewer from a PR
   */
  async removeReviewer(prNumber: number, reviewer: string): Promise<void> {
    await this.octokit.pulls.removeRequestedReviewers({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      reviewers: [reviewer],
    });
  }

  /**
   * Submit a review
   */
  async submitReview(
    prNumber: number,
    state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body?: string
  ): Promise<ReviewInfo> {
    const { data } = await this.octokit.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      event: state,
      body: body || '',
    });

    return {
      id: data.id,
      state: data.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED',
      body: data.body || undefined,
      user: {
        login: data.user.login,
      },
    };
  }

  /**
   * Dismiss a review
   */
  async dismissReview(prNumber: number, reviewId: number, message: string): Promise<void> {
    await this.octokit.pulls.dismissReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      review_id: reviewId,
      message,
    });
  }

  /**
   * Get reviews for a PR
   */
  async getReviews(prNumber: number): Promise<ReviewInfo[]> {
    const { data } = await this.octokit.pulls.listReviews({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return data.map((review) => ({
      id: review.id,
      state: review.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED',
      body: review.body || undefined,
      user: {
        login: review.user.login,
      },
    }));
  }

  /**
   * Merge a pull request
   */
  async mergePR(prNumber: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<void> {
    await this.octokit.pulls.merge({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
    });
  }

  /**
   * Close a pull request
   */
  async closePR(prNumber: number): Promise<void> {
    await this.updatePR(prNumber, { state: 'closed' });
  }

  /**
   * Get PR details
   */
  async getPR(prNumber: number): Promise<PRInfo> {
    const { data } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return {
      number: data.number,
      title: data.title,
      url: data.html_url,
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      base: {
        ref: data.base.ref,
      },
      draft: data.draft,
      state: data.state,
      merged: data.merged,
    };
  }

  /**
   * Get PR comments
   */
  async getPRComments(prNumber: number): Promise<Array<{ id: number; body: string; user: { login: string } }>> {
    const { data } = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
    });

    return data.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        login: comment.user.login,
      },
    }));
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branch: string): Promise<void> {
    try {
      await this.octokit.git.deleteRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branch}`,
      });
    } catch (error: any) {
      // Ignore if branch doesn't exist or is default branch
      if (error.status !== 422 && error.status !== 404) {
        throw error;
      }
    }
  }

  /**
   * Get workflow runs for a PR
   */
  async getWorkflowRuns(prNumber: number): Promise<Array<{ id: number; status: string; conclusion: string | null }>> {
    const { data } = await this.octokit.actions.listWorkflowRunsForRepo({
      owner: this.owner,
      repo: this.repo,
      per_page: 100,
    });

    // Filter runs that might be related to this PR
    // Note: GitHub API doesn't directly filter by PR, so we get recent runs
    return data.workflow_runs.map((run) => ({
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
    }));
  }
}
