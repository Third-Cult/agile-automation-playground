#!/usr/bin/env node

/**
 * Verify E2E Test Environment Configuration
 */

require('dotenv').config();

const required = [
  'GITHUB_REPO_OWNER',
  'GITHUB_REPO_NAME',
  'DISCORD_BOT_TOKEN',
  'DISCORD_TEST_CHANNEL_ID',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.log('\n❌ Missing required environment variables:');
  missing.forEach((key) => console.log(`   - ${key}`));
  console.log('\nPlease check your .env file and ensure all required variables are set.');
  process.exit(1);
}

// Check GitHub authentication
const hasPAT = !!process.env.GITHUB_TOKEN;
const hasAppId = !!process.env.GITHUB_APP_ID;
const hasAppKey = !!process.env.GITHUB_APP_PRIVATE_KEY;
const hasApp = hasAppId && hasAppKey;

if (!hasPAT && !hasApp) {
  console.log('\n❌ Missing GitHub authentication:');
  console.log('   Either GITHUB_TOKEN or GitHub App configuration (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY) is required.');
  console.log('\nPlease configure either:');
  console.log('  1. GITHUB_TOKEN (Personal Access Token), or');
  console.log('  2. GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (GitHub App)');
  process.exit(1);
}

if (hasApp && !hasAppId) {
  console.log('\n⚠️  GitHub App configuration incomplete:');
  console.log('   GITHUB_APP_PRIVATE_KEY is set but GITHUB_APP_ID is missing.');
  process.exit(1);
}

if (hasApp && !hasAppKey) {
  console.log('\n⚠️  GitHub App configuration incomplete:');
  console.log('   GITHUB_APP_ID is set but GITHUB_APP_PRIVATE_KEY is missing.');
  process.exit(1);
}

console.log('\n✅ All required environment variables are set!\n');
console.log('📋 Configuration:');
console.log(`   GitHub Owner: ${process.env.GITHUB_REPO_OWNER}`);
console.log(`   GitHub Repo: ${process.env.GITHUB_REPO_NAME}`);

if (hasPAT) {
  console.log(`   GitHub Auth: Personal Access Token (${process.env.GITHUB_TOKEN.substring(0, 10)}...)`);
} else if (hasApp) {
  console.log(`   GitHub Auth: GitHub App (ID: ${process.env.GITHUB_APP_ID})`);
  if (process.env.GITHUB_APP_INSTALLATION_ID) {
    console.log(`   Installation ID: ${process.env.GITHUB_APP_INSTALLATION_ID} (will be auto-discovered if not provided)`);
  } else {
    console.log(`   Installation ID: Will be auto-discovered`);
  }
}

console.log(`   Discord Channel: ${process.env.DISCORD_TEST_CHANNEL_ID}`);
console.log(`   Test Reviewers: ${process.env.E2E_TEST_REVIEWERS || 'Not set (optional)'}`);
console.log('\n✅ Ready to run E2E tests!');
console.log('   Try: npm run test:e2e -- -t "PR Opened Draft"\n');
