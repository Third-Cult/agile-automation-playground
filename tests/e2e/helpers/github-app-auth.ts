import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import type { E2EConfig } from '../config';

/**
 * Mask sensitive values in strings (for logging/error messages)
 */
function maskSensitive(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars * 2) {
    return '*'.repeat(value.length);
  }
  return value.slice(0, visibleChars) + '*'.repeat(value.length - visibleChars * 2) + value.slice(-visibleChars);
}

/**
 * Auto-discover installation ID for a repository
 */
async function getInstallationId(
  appAuth: ReturnType<typeof createAppAuth>,
  owner: string,
  repo: string
): Promise<number> {
  try {
    // Authenticate as the app to get app-level access
    const appAuthentication = await appAuth({ type: 'app' });
    
    // Create a temporary Octokit instance with app-level auth
    const tempOctokit = new Octokit({
      auth: appAuthentication.token,
    });
    
    const { data } = await tempOctokit.apps.getRepoInstallation({
      owner,
      repo,
    });
    return data.id;
  } catch (error: any) {
    if (error.status === 404) {
      throw new Error(
        `GitHub App is not installed on ${owner}/${repo}. ` +
        `Please install the app on the repository or provide GITHUB_APP_INSTALLATION_ID.`
      );
    }
    throw new Error(
      `Failed to discover installation ID for ${owner}/${repo}: ${error.message}`
    );
  }
}

/**
 * Create an authenticated Octokit instance using GitHub App
 */
export async function createAppOctokit(config: E2EConfig['github']): Promise<Octokit> {
  if (!config.appId || !config.appPrivateKey) {
    throw new Error('GitHub App configuration is incomplete. appId and appPrivateKey are required.');
  }

  // Create app auth instance
  const appAuth = createAppAuth({
    appId: config.appId,
    privateKey: config.appPrivateKey,
  });

  // Get or discover installation ID
  let installationId = config.installationId;
  if (!installationId) {
    console.log(`🔍 Auto-discovering installation ID for ${config.owner}/${config.repo}...`);
    installationId = await getInstallationId(appAuth, config.owner, config.repo);
    console.log(`✓ Found installation ID: ${installationId}`);
  }

  // Get installation token
  // Installation tokens are valid for 1 hour, which is sufficient for e2e tests
  const installationAuth = await appAuth({
    type: 'installation',
    installationId,
  });

  // Create Octokit instance with the installation token
  return new Octokit({
    auth: installationAuth.token,
  });
}

/**
 * Create an authenticated Octokit instance using either GitHub App or PAT
 */
export async function createAuthenticatedOctokit(config: E2EConfig['github']): Promise<Octokit> {
  // Prefer GitHub App if configured
  if (config.appId && config.appPrivateKey) {
    try {
      return await createAppOctokit(config);
    } catch (error: any) {
      // Mask sensitive values in error messages
      const errorMessage = error.message || String(error);
      let maskedMessage = errorMessage;
      
      if (config.appPrivateKey) {
        // Mask private key snippets in error messages
        const keySnippet = config.appPrivateKey.slice(0, Math.min(20, config.appPrivateKey.length));
        maskedMessage = maskedMessage.replace(new RegExp(keySnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), maskSensitive(keySnippet));
      }
      
      if (config.appId) {
        maskedMessage = maskedMessage.replace(new RegExp(String(config.appId), 'g'), maskSensitive(String(config.appId)));
      }
      
      throw new Error(`GitHub App authentication failed: ${maskedMessage}`);
    }
  }

  // Fall back to PAT
  if (config.token) {
    return new Octokit({ auth: config.token });
  }

  throw new Error(
    'No authentication method configured. Provide either GITHUB_TOKEN or GitHub App configuration.'
  );
}
