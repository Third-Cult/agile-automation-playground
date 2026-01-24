#!/usr/bin/env node

/**
 * Run a Single E2E Test
 * 
 * This script ensures only one test runs at a time by using exact matching.
 * 
 * Usage:
 *   node tests/e2e/run-single-test.js 1
 *   node tests/e2e/run-single-test.js 2
 *   etc.
 */

const { execSync } = require('child_process');
const testNumber = process.argv[2];

if (!testNumber) {
  console.error('❌ Please provide a test number (1-15)');
  console.error('   Usage: node tests/e2e/run-single-test.js <test-number>');
  console.error('   Example: node tests/e2e/run-single-test.js 1');
  process.exit(1);
}

const testNum = parseInt(testNumber, 10);
if (isNaN(testNum) || testNum < 1 || testNum > 15) {
  console.error(`❌ Invalid test number: ${testNumber}`);
  console.error('   Test number must be between 1 and 15');
  process.exit(1);
}

console.log(`\n🧪 Running Test ${testNum} only...\n`);

try {
  // Use exact match pattern to ensure only this test runs
  // Match the specific test name to avoid evaluating skipped tests
  // Use dot reporter to avoid flooding console with "↓ Test X [skipped]" lines
  const command = `npx vitest run tests/e2e -t "Test ${testNum}: should" --reporter=dot`;
  execSync(command, { stdio: 'inherit' });
} catch (error) {
  console.error(`\n❌ Test ${testNum} failed`);
  process.exit(1);
}
