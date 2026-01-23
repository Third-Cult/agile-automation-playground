import dotenv from 'dotenv';

// Load environment variables from .env file if it exists
dotenv.config();

export interface E2EConfig {
  github: {
    token?: string; // Optional if app is used
    appId?: number;
    appPrivateKey?: string;
    installationId?: number; // Optional - will be auto-discovered if not provided
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

function getEnvVarOptional(name: string): string | undefined {
  return process.env[name];
}

function getEnvVarNumberOptional(name: string): number | undefined {
  const value = process.env[name];
  return value ? parseInt(value, 10) : undefined;
}

export function loadConfig(): E2EConfig {
  const token = getEnvVarOptional('GITHUB_TOKEN');
  const appId = getEnvVarNumberOptional('GITHUB_APP_ID');
  const appPrivateKey = getEnvVarOptional('GITHUB_APP_PRIVATE_KEY');
  const installationId = getEnvVarNumberOptional('GITHUB_APP_INSTALLATION_ID');

  // Validate that either PAT or App config is provided
  const hasPAT = !!token;
  const hasApp = !!(appId && appPrivateKey);

  if (!hasPAT && !hasApp) {
    throw new Error(
      'Either GITHUB_TOKEN or GitHub App configuration (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY) is required. ' +
      'If using GitHub App, provide GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY. ' +
      'GITHUB_APP_INSTALLATION_ID is optional and will be auto-discovered if not provided.'
    );
  }

  // Handle base64-encoded private key (common in secret managers)
  let processedPrivateKey = appPrivateKey;
  if (appPrivateKey && !appPrivateKey.includes('-----BEGIN')) {
    // Assume it's base64-encoded, decode it
    try {
      processedPrivateKey = Buffer.from(appPrivateKey, 'base64').toString('utf-8');
    } catch (error) {
      throw new Error(
        'GITHUB_APP_PRIVATE_KEY appears to be base64-encoded but could not be decoded. ' +
        'Please provide either a raw PEM-formatted key or a valid base64-encoded key.'
      );
    }
  }

  return {
    github: {
      token,
      appId,
      appPrivateKey: processedPrivateKey,
      installationId,
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
