#!/usr/bin/env node

/**
 * Verify E2E Test Environment Configuration
 */

require('dotenv').config();

const required = [
  'GITHUB_TOKEN',
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

console.log('\n✅ All required environment variables are set!\n');
console.log('📋 Configuration:');
console.log(`   GitHub Owner: ${process.env.GITHUB_REPO_OWNER}`);
console.log(`   GitHub Repo: ${process.env.GITHUB_REPO_NAME}`);
console.log(`   GitHub Token: ${process.env.GITHUB_TOKEN.substring(0, 10)}...`);
console.log(`   Discord Channel: ${process.env.DISCORD_TEST_CHANNEL_ID}`);
console.log(`   Test Reviewers: ${process.env.E2E_TEST_REVIEWERS || 'Not set (optional)'}`);
console.log('\n✅ Ready to run E2E tests!');
console.log('   Try: npm run test:e2e -- -t "PR Opened Draft"\n');
