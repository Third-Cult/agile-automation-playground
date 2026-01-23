#!/usr/bin/env node

/**
 * Helper script to find the Installation ID for a GitHub App
 */

require('dotenv').config();
const { createAppAuth } = require('@octokit/auth-app');
const { Octokit } = require('@octokit/rest');

async function findInstallationId() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;

  if (!appId || !privateKey) {
    console.error('❌ GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
    process.exit(1);
  }

  if (!owner || !repo) {
    console.error('❌ GITHUB_REPO_OWNER and GITHUB_REPO_NAME are required');
    process.exit(1);
  }

  console.log(`\n🔍 Finding Installation ID for ${owner}/${repo}...\n`);

  try {
    // Create app auth
    const appAuth = createAppAuth({
      appId: Number(appId),
      privateKey: privateKey.includes('-----BEGIN') 
        ? privateKey 
        : Buffer.from(privateKey, 'base64').toString('utf-8'),
    });

    // Authenticate as app
    const appAuthResult = await appAuth({ type: 'app' });
    const octokit = new Octokit({ auth: appAuthResult.token });

    // Try to get installation for the specific repository
    try {
      const { data: repoInstallation } = await octokit.apps.getRepoInstallation({
        owner,
        repo,
      });
      console.log(`✅ Found Installation ID: ${repoInstallation.id}`);
      console.log(`\nAdd this to your .env file:`);
      console.log(`GITHUB_APP_INSTALLATION_ID=${repoInstallation.id}\n`);
      return repoInstallation.id;
    } catch (repoError) {
      if (repoError.status === 404) {
        console.log(`⚠️  App is not installed on ${owner}/${repo}`);
        console.log(`\n📋 Listing all installations for this app...\n`);
        
        // List all installations
        const { data: installations } = await octokit.apps.listInstallations();
        
        if (installations.length === 0) {
          console.log('❌ No installations found for this app');
          console.log('\nPlease install the app on your organization/repository first.');
          process.exit(1);
        }

        console.log(`Found ${installations.length} installation(s):\n`);
        installations.forEach((installation, index) => {
          console.log(`${index + 1}. Installation ID: ${installation.id}`);
          console.log(`   Account: ${installation.account?.login || 'Unknown'}`);
          console.log(`   Type: ${installation.account?.type || 'Unknown'}`);
          console.log(`   Repository Selection: ${installation.repository_selection || 'Unknown'}`);
          console.log(`   Repositories: ${installation.repositories_count || 0} repository(ies)`);
          console.log('');
        });

        // If there's only one installation, suggest it
        if (installations.length === 1) {
          const installation = installations[0];
          console.log(`💡 Suggested Installation ID: ${installation.id}`);
          console.log(`\nAdd this to your .env file:`);
          console.log(`GITHUB_APP_INSTALLATION_ID=${installation.id}\n`);
          
          // Check if it has access to the repo
          if (installation.repository_selection === 'all') {
            console.log('✅ This installation has access to all repositories');
          } else {
            console.log('⚠️  This installation may not have access to your repository.');
            console.log('   Please verify the repository is selected in the app settings.');
          }
        } else {
          console.log('💡 Please select the correct Installation ID from the list above.');
          console.log('   The Installation ID should match the installation for your organization/account.\n');
        }
      } else {
        throw repoError;
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.status) {
      console.error(`   Status: ${error.status}`);
    }
    process.exit(1);
  }
}

findInstallationId().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
