// TypeScript type definitions for Discord PR Notifications

export interface DiscordMetadata {
    message_id: string;
    thread_id: string;
    channel_id: string;
  }
  
  export interface UserMapping {
    [githubUsername: string]: string; // Maps to Discord user ID
  }
  
  export interface GitHubUser {
    login: string;
    id?: number;
    [key: string]: any; // Allow additional properties from GitHub API
  }
  
  export interface GitHubReviewer extends GitHubUser {
    type?: string;
  }
  
  export interface GitHubPullRequest {
    number: number;
    title: string;
    html_url: string;
    body: string | null;
    draft: boolean;
    state: string;
    user: GitHubUser;
    base: {
      ref: string;
    };
    head: {
      ref: string;
    };
    requested_reviewers?: GitHubReviewer[];
    merged?: boolean;
    merged_by?: GitHubUser | null;
    merge_commit_sha?: string | null;
  }
  
  export interface GitHubReview {
    id: number;
    user: GitHubUser;
    state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
    body: string | null;
  }
  
  export interface GitHubComment {
    id: number;
    body?: string | null;
    user: GitHubUser;
    created_at: string;
  }
  
  export interface GitHubEventPayload {
    pull_request: GitHubPullRequest;
    review?: GitHubReview;
    requested_reviewer?: GitHubReviewer;
    action: string;
  }
  
  export interface DiscordMessage {
    id: string;
    content: string;
    channel_id: string;
  }
  
  export interface DiscordThread {
    id: string;
    name: string;
    locked?: boolean;
    archived?: boolean;
  }
  
  export interface HandlerContext {
    github: {
      rest: any; // Using any to match actual Octokit RestEndpointMethods type
    };
    repo: {
      owner: string;
      repo: string;
    };
    payload: GitHubEventPayload;
  }
  
  export interface Core {
    setFailed: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
    error: (message: string) => void;
  }
  
  export interface Env {
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
    DISCORD_USER_MAPPING?: string;
    DISCORD_OPERATIONS_ROLE_ID?: string;
    GITHUB_TOKEN?: string;
    GITHUB_EVENT_NAME?: string;
    GITHUB_EVENT_PATH?: string;
    GITHUB_REPOSITORY?: string;
    GITHUB_REPO_OWNER?: string;
  }
  