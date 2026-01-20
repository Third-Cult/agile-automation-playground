import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import type { HandlerContext, Core, UserMapping, Env } from './types';
import { handlePROpened } from './handlers/handle-pr-opened';
import { handlePRReadyForReview } from './handlers/handle-pr-ready-for-review';
import { handleReviewerAdded } from './handlers/handle-reviewer-added';
import { handleReviewerRemoved } from './handlers/handle-reviewer-removed';
import { handlePRReview } from './handlers/handle-pr-review';
import { handlePRSynchronize } from './handlers/handle-pr-synchronize';
import { handleReviewDismissed } from './handlers/handle-review-dismissed';
import { handlePRClosed } from './handlers/handle-pr-closed';
import { handlePRMerged } from './handlers/handle-pr-merged';

/**
 * Create a Core wrapper that matches our Core interface
 */
function createCore(): Core {
  return {
    setFailed: (message: string) => core.setFailed(message),
    warning: (message: string) => core.warning(message),
    info: (message: string) => core.info(message),
    error: (message: string) => core.error(message),
  };
}

/**
 * Parse environment variables
 */
function getEnv(): Env {
  return {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
    DISCORD_USER_MAPPING: process.env.DISCORD_USER_MAPPING,
    DISCORD_OPERATIONS_ROLE_ID: process.env.DISCORD_OPERATIONS_ROLE_ID,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
    GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_REPO_OWNER: process.env.GITHUB_REPO_OWNER,
  };
}

/**
 * Load and parse the GitHub event payload
 */
function loadEventPayload(eventPath?: string): any {
  const path = eventPath || process.env.GITHUB_EVENT_PATH || '/github/workflow/event.json';
  try {
    const eventData = fs.readFileSync(path, 'utf8');
    return JSON.parse(eventData);
  } catch (e) {
    throw new Error(`Failed to load event payload: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Parse user mapping from environment variable
 */
function parseUserMapping(userMappingStr?: string): UserMapping {
  if (!userMappingStr) {
    return {};
  }
  try {
    return JSON.parse(userMappingStr);
  } catch (e) {
    throw new Error(`Failed to parse DISCORD_USER_MAPPING: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const coreWrapper = createCore();
  const env = getEnv();
  const eventName = env.GITHUB_EVENT_NAME;

  if (!eventName) {
    coreWrapper.setFailed('GITHUB_EVENT_NAME environment variable is required');
    return;
  }

  // Initialize GitHub client
  const token = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    coreWrapper.setFailed('GITHUB_TOKEN is required');
    return;
  }

  const octokit = github.getOctokit(token);

  // Load event payload
  const payload = loadEventPayload(env.GITHUB_EVENT_PATH);

  // Parse repository info - prefer environment variable, fallback to github.context
  let owner: string;
  let repo: string;
  if (env.GITHUB_REPOSITORY) {
    [owner, repo] = env.GITHUB_REPOSITORY.split('/');
  } else if (env.GITHUB_REPO_OWNER) {
    owner = env.GITHUB_REPO_OWNER;
    repo = github.context.repo.repo;
  } else {
    owner = github.context.repo.owner;
    repo = github.context.repo.repo;
  }

  // Create handler context
  const context: HandlerContext = {
    github: {
      rest: octokit.rest,
    },
    repo: {
      owner,
      repo,
    },
    payload,
  };

  // Parse user mapping
  const userMapping = parseUserMapping(env.DISCORD_USER_MAPPING);

  // Get required secrets
  const botToken = env.DISCORD_BOT_TOKEN;
  const channelId = env.DISCORD_CHANNEL_ID;

  if (!botToken) {
    coreWrapper.setFailed('DISCORD_BOT_TOKEN secret must be set');
    return;
  }

  // Route to appropriate handler based on event
  try {
    if (eventName === 'pull_request') {
      const action = payload.action;

      if (action === 'opened') {
        if (!channelId) {
          coreWrapper.setFailed('DISCORD_CHANNEL_ID secret must be set');
          return;
        }
        await handlePROpened(context, coreWrapper, botToken, channelId, userMapping);
      } else if (action === 'ready_for_review') {
        await handlePRReadyForReview(context, coreWrapper, botToken, userMapping);
      } else if (action === 'review_requested') {
        await handleReviewerAdded(context, coreWrapper, botToken, userMapping);
      } else if (action === 'review_request_removed') {
        await handleReviewerRemoved(context, coreWrapper, botToken, userMapping);
      } else if (action === 'synchronize') {
        await handlePRSynchronize(context, coreWrapper, botToken, userMapping);
      } else if (action === 'closed') {
        if (payload.pull_request?.merged === true) {
          await handlePRMerged(context, coreWrapper, botToken, userMapping);
        } else {
          await handlePRClosed(context, coreWrapper, botToken, userMapping);
        }
      }
    } else if (eventName === 'pull_request_review') {
      const action = payload.action;

      if (action === 'submitted') {
        await handlePRReview(context, coreWrapper, botToken, userMapping);
      } else if (action === 'dismissed') {
        await handleReviewDismissed(context, coreWrapper, botToken, userMapping);
      }
    } else {
      coreWrapper.warning(`Unhandled event: ${eventName}`);
    }
  } catch (error) {
    coreWrapper.setFailed(`Handler failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Run main function
main().catch((error) => {
  core.setFailed(`Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
