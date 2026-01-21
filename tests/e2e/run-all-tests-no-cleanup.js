#!/usr/bin/env node

/**
 * Run All E2E Tests Without Cleanup
 * 
 * This script runs all E2E tests without cleanup so you can inspect the results.
 * 
 * Usage:
 *   node tests/e2e/run-all-tests-no-cleanup.js
 */

const { execSync } = require('child_process');

// Set E2E_CLEANUP to false
process.env.E2E_CLEANUP = 'false';

console.log('\n🧪 Running all E2E tests WITHOUT cleanup...\n');
console.log('⚠️  Note: Resources will NOT be cleaned up automatically.\n');
console.log('   Run "npm run test:e2e:cleanup" to clean up manually.\n');

try {
  execSync('npx vitest run tests/e2e', { stdio: 'inherit', env: process.env });
} catch (error) {
  console.error('\n❌ Tests failed');
  process.exit(1);
}
