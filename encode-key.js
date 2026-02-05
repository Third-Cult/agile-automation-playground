#!/usr/bin/env node

/**
 * Quick script to base64-encode a GitHub App private key
 * Usage: node encode-key.js <path-to-private-key.pem>
 */

const fs = require('fs');
const path = require('path');

const keyPath = process.argv[2];

if (!keyPath) {
  console.error('Usage: node encode-key.js <path-to-private-key.pem>');
  console.error('\nExample:');
  console.error('  node encode-key.js ./review-app-key.pem');
  process.exit(1);
}

if (!fs.existsSync(keyPath)) {
  console.error(`Error: File not found: ${keyPath}`);
  process.exit(1);
}

try {
  const keyContent = fs.readFileSync(keyPath, 'utf8');
  const base64Encoded = Buffer.from(keyContent, 'utf8').toString('base64');
  
  console.log('\n✅ Base64-encoded private key:\n');
  console.log(base64Encoded);
  console.log('\n📋 Copy the above and use it as GITHUB_REVIEW_APP_PRIVATE_KEY in your .env file\n');
} catch (error) {
  console.error('Error encoding key:', error.message);
  process.exit(1);
}
