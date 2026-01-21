#!/usr/bin/env node

/**
 * E2E Test Environment Setup Script
 * 
 * This script helps you set up the environment variables needed for E2E tests.
 * It will check what you have configured and guide you through the setup.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

function checkEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    return fs.readFileSync(envPath, 'utf8');
  }
  return null;
}

function parseEnvFile(content) {
  const env = {};
  if (!content) return env;
  
  content.split('\n').forEach((line) => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  
  return env;
}

function checkExistingConfig() {
  const envContent = checkEnvFile();
  const existing = parseEnvFile(envContent);
  
  console.log('\n📋 Current Configuration Status:\n');
  
  const required = {
    'GITHUB_TOKEN': 'GitHub Personal Access Token',
    'GITHUB_REPO_OWNER': 'GitHub Repository Owner',
    'GITHUB_REPO_NAME': 'GitHub Repository Name',
    'DISCORD_BOT_TOKEN': 'Discord Bot Token',
    'DISCORD_TEST_CHANNEL_ID': 'Discord Test Channel ID',
  };
  
  const optional = {
    'DISCORD_PR_CHANNEL_ID': 'Discord Production Channel ID (fallback)',
    'E2E_TEST_PREFIX': 'Test prefix (default: e2e-test)',
    'E2E_CLEANUP': 'Auto cleanup (default: true)',
    'E2E_TEST_REVIEWERS': 'Test reviewers (comma-separated GitHub usernames)',
  };
  
  let allConfigured = true;
  
  console.log('Required Variables:');
  for (const [key, description] of Object.entries(required)) {
    const value = existing[key] || process.env[key];
    if (value) {
      const masked = key.includes('TOKEN') ? `${value.substring(0, 10)}...` : value;
      console.log(`  ✅ ${key}: ${masked}`);
    } else {
      console.log(`  ❌ ${key}: Not set (${description})`);
      allConfigured = false;
    }
  }
  
  console.log('\nOptional Variables:');
  for (const [key, description] of Object.entries(optional)) {
    const value = existing[key] || process.env[key];
    if (value) {
      const masked = key.includes('TOKEN') ? `${value.substring(0, 10)}...` : value;
      console.log(`  ℹ️  ${key}: ${masked}`);
    } else {
      console.log(`  ⚪ ${key}: Not set (${description})`);
    }
  }
  
  return { existing, allConfigured };
}

async function interactiveSetup() {
  console.log('\n🔧 E2E Test Environment Setup\n');
  console.log('This script will help you configure the environment variables needed for E2E tests.\n');
  
  const { existing, allConfigured } = checkExistingConfig();
  
  if (allConfigured) {
    console.log('\n✅ All required variables are configured!');
    const proceed = await question('\nDo you want to update any values? (y/N): ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('\nSetup complete. You can run tests with: npm run test:e2e');
      rl.close();
      return;
    }
  }
  
  console.log('\n📝 Let\'s configure the required variables:\n');
  
  const config = { ...existing };
  
  // GitHub Token
  if (!config.GITHUB_TOKEN && !process.env.GITHUB_TOKEN) {
    console.log('GitHub Personal Access Token:');
    console.log('  You can use either a Classic or Fine-grained token:');
    console.log('');
    console.log('  Classic Token:');
    console.log('    1. Go to: https://github.com/settings/tokens');
    console.log('    2. Click "Generate new token" → "Generate new token (classic)"');
    console.log('    3. Select "repo" scope');
    console.log('    4. Copy the token (starts with ghp_)');
    console.log('');
    console.log('  Fine-grained Token:');
    console.log('    1. Go to: https://github.com/settings/tokens');
    console.log('    2. Click "Generate new token" → "Generate new token (fine-grained)"');
    console.log('    3. Select your repository');
    console.log('    4. Set permissions:');
    console.log('       - Contents: Read and write');
    console.log('       - Pull requests: Read and write');
    console.log('       - Issues: Read');
    console.log('       - Actions: Read');
    console.log('    5. Copy the token (starts with github_pat_)');
    const token = await question('\nEnter your GitHub token (ghp_... or github_pat_...): ');
    if (token.trim()) config.GITHUB_TOKEN = token.trim();
  }
  
  // GitHub Repo Owner
  if (!config.GITHUB_REPO_OWNER && !process.env.GITHUB_REPO_OWNER) {
    const owner = await question('Enter GitHub repository owner (org or username): ');
    if (owner.trim()) config.GITHUB_REPO_OWNER = owner.trim();
  }
  
  // GitHub Repo Name
  if (!config.GITHUB_REPO_NAME && !process.env.GITHUB_REPO_NAME) {
    const repo = await question('Enter GitHub repository name: ');
    if (repo.trim()) config.GITHUB_REPO_NAME = repo.trim();
  }
  
  // Discord Bot Token
  if (!config.DISCORD_BOT_TOKEN && !process.env.DISCORD_BOT_TOKEN) {
    console.log('\nDiscord Bot Token:');
    console.log('  1. Go to: https://discord.com/developers/applications');
    console.log('  2. Select your bot application');
    console.log('  3. Go to "Bot" section');
    console.log('  4. Copy the token');
    const token = await question('\nEnter your Discord bot token: ');
    if (token.trim()) config.DISCORD_BOT_TOKEN = token.trim();
  }
  
  // Discord Channel ID
  if (!config.DISCORD_TEST_CHANNEL_ID && !process.env.DISCORD_TEST_CHANNEL_ID) {
    console.log('\nDiscord Channel ID:');
    console.log('  1. Enable Developer Mode in Discord (User Settings → Advanced)');
    console.log('  2. Right-click on the channel');
    console.log('  3. Click "Copy ID"');
    const channelId = await question('\nEnter Discord test channel ID: ');
    if (channelId.trim()) config.DISCORD_TEST_CHANNEL_ID = channelId.trim();
  }
  
  // Optional: Test Reviewers
  if (!config.E2E_TEST_REVIEWERS && !process.env.E2E_TEST_REVIEWERS) {
    const reviewers = await question('\nEnter test reviewers (GitHub usernames, comma-separated, optional): ');
    if (reviewers.trim()) config.E2E_TEST_REVIEWERS = reviewers.trim();
  }
  
  // Save to .env file
  const envPath = path.join(process.cwd(), '.env');
  const envLines = [];
  
  envLines.push('# E2E Test Configuration');
  envLines.push('# Generated by setup-env.js');
  envLines.push('');
  envLines.push('# GitHub Configuration');
  envLines.push(`GITHUB_TOKEN=${config.GITHUB_TOKEN || ''}`);
  envLines.push(`GITHUB_REPO_OWNER=${config.GITHUB_REPO_OWNER || ''}`);
  envLines.push(`GITHUB_REPO_NAME=${config.GITHUB_REPO_NAME || ''}`);
  envLines.push('');
  envLines.push('# Discord Configuration');
  envLines.push(`DISCORD_BOT_TOKEN=${config.DISCORD_BOT_TOKEN || ''}`);
  envLines.push(`DISCORD_TEST_CHANNEL_ID=${config.DISCORD_TEST_CHANNEL_ID || ''}`);
  if (config.DISCORD_PR_CHANNEL_ID) {
    envLines.push(`DISCORD_PR_CHANNEL_ID=${config.DISCORD_PR_CHANNEL_ID}`);
  }
  envLines.push('');
  envLines.push('# Test Configuration');
  envLines.push(`E2E_TEST_PREFIX=${config.E2E_TEST_PREFIX || 'e2e-test'}`);
  envLines.push(`E2E_CLEANUP=${config.E2E_CLEANUP || 'true'}`);
  envLines.push(`E2E_TIMEOUT=${config.E2E_TIMEOUT || '300000'}`);
  envLines.push(`E2E_WORKFLOW_TIMEOUT=${config.E2E_WORKFLOW_TIMEOUT || '300000'}`);
  envLines.push(`E2E_DISCORD_POLL_INTERVAL=${config.E2E_DISCORD_POLL_INTERVAL || '2000'}`);
  envLines.push(`E2E_DISCORD_POLL_TIMEOUT=${config.E2E_DISCORD_POLL_TIMEOUT || '120000'}`);
  if (config.E2E_TEST_REVIEWERS) {
    envLines.push(`E2E_TEST_REVIEWERS=${config.E2E_TEST_REVIEWERS}`);
  }
  
  fs.writeFileSync(envPath, envLines.join('\n') + '\n');
  
  console.log('\n✅ Configuration saved to .env file!');
  console.log('\n📋 Next Steps:');
  console.log('  1. Verify the .env file contains correct values');
  console.log('  2. Ensure your GitHub repository has the Discord PR Notifications workflow enabled');
  console.log('  3. Ensure your Discord bot has the required permissions');
  console.log('  4. Run a test: npm run test:e2e -- -t "PR Opened Draft"');
  
  rl.close();
}

// Run setup
interactiveSetup().catch((error) => {
  console.error('Error during setup:', error);
  rl.close();
  process.exit(1);
});
