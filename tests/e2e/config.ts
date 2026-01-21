import dotenv from 'dotenv';

// Load environment variables from .env file if it exists
dotenv.config();

export interface E2EConfig {
  github: {
    token: string;
    owner: string;
    repo: string;
  };
  discord: {
    botToken: string;
    channelId: string;
  };
  test: {
    prefix: string;
    cleanup: boolean;
    timeout: number;
    workflowTimeout: number;
    discordPollInterval: number;
    discordPollTimeout: number;
    reviewers?: string[]; // Optional test reviewers (GitHub usernames)
  };
}

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function getEnvVarNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvVarBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  return value ? value.toLowerCase() === 'true' : defaultValue;
}

export function loadConfig(): E2EConfig {
  return {
    github: {
      token: getEnvVar('GITHUB_TOKEN'),
      owner: getEnvVar('GITHUB_REPO_OWNER'),
      repo: getEnvVar('GITHUB_REPO_NAME'),
    },
    discord: {
      botToken: getEnvVar('DISCORD_BOT_TOKEN'),
      channelId: process.env.DISCORD_TEST_CHANNEL_ID || getEnvVar('DISCORD_PR_CHANNEL_ID'),
    },
    test: {
      prefix: getEnvVar('E2E_TEST_PREFIX', 'e2e-test'),
      cleanup: getEnvVarBoolean('E2E_CLEANUP', true),
      timeout: getEnvVarNumber('E2E_TIMEOUT', 300000), // 5 minutes
      workflowTimeout: getEnvVarNumber('E2E_WORKFLOW_TIMEOUT', 300000), // 5 minutes
      discordPollInterval: getEnvVarNumber('E2E_DISCORD_POLL_INTERVAL', 2000), // 2 seconds
      discordPollTimeout: getEnvVarNumber('E2E_DISCORD_POLL_TIMEOUT', 120000), // 2 minutes
      reviewers: process.env.E2E_TEST_REVIEWERS
        ? process.env.E2E_TEST_REVIEWERS.split(',').map((r) => r.trim())
        : undefined,
    },
  };
}
