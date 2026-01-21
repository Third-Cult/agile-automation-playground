#!/usr/bin/env node

/**
 * Run a Single E2E Test Without Cleanup
 * 
 * This script runs a single test without cleanup so you can inspect the results.
 * 
 * Usage:
 *   node tests/e2e/run-single-test-no-cleanup.js 1
 *   node tests/e2e/run-single-test-no-cleanup.js 2
 *   etc.
 */

const { execSync } = require('child_process');
const testNumber = process.argv[2];

if (!testNumber) {
  console.error('❌ Please provide a test number (1-15)');
  console.error('   Usage: node tests/e2e/run-single-test-no-cleanup.js <test-number>');
  console.error('   Example: node tests/e2e/run-single-test-no-cleanup.js 1');
  process.exit(1);
}

const testNum = parseInt(testNumber, 10);
if (isNaN(testNum) || testNum < 1 || testNum > 15) {
  console.error(`❌ Invalid test number: ${testNumber}`);
  console.error('   Test number must be between 1 and 15');
  process.exit(1);
}

// Set E2E_CLEANUP to false
process.env.E2E_CLEANUP = 'false';

console.log(`\n🧪 Running Test ${testNum} only (NO CLEANUP)...\n`);
console.log('⚠️  Note: Resources will NOT be cleaned up automatically.\n');
console.log('   Run "npm run test:e2e:cleanup" to clean up manually.\n');

try {
  // Use exact match pattern to ensure only this test runs
  const command = `npx vitest run tests/e2e -t "Test ${testNum}:"`;
  execSync(command, { stdio: 'inherit', env: process.env });
} catch (error) {
  console.error(`\n❌ Test ${testNum} failed`);
  process.exit(1);
}
