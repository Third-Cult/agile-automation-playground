# E2E Testing Guide

This document provides instructions for setting up and running end-to-end (E2E) tests for the Discord PR Notifications system.

## Overview

E2E tests verify that the system works correctly by interacting with live GitHub and Discord instances. These tests create real PRs, trigger workflows, and verify Discord messages are created and updated correctly.

## Prerequisites

1. **GitHub Repository**: A test repository with the Discord PR Notifications workflow enabled
2. **Discord Server**: A test Discord server with:
   - Bot added and configured
   - Channel ID for PR notifications
   - Bot has required permissions
3. **GitHub Personal Access Token (PAT)**:
   - **Classic Token**: Create a PAT with `repo` scope
   - **Fine-grained Token** (Recommended): Create with these permissions:
     - Contents: Read and write
     - Pull requests: Read and write
     - Issues: Read
     - Actions: Read
   - Must have write access to the test repository
4. **Discord Bot Token**: Bot token for the Discord bot
5. **Test Reviewers** (optional): GitHub usernames for testing reviewer scenarios

## Environment Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root (or set environment variables):

```bash
# GitHub Configuration
# Token can be classic (ghp_...) or fine-grained (github_pat_...)
GITHUB_TOKEN=ghp_your_personal_access_token_here
# Or for fine-grained: GITHUB_TOKEN=github_pat_your_fine_grained_token_here
GITHUB_REPO_OWNER=your-org-or-username
GITHUB_REPO_NAME=your-test-repo

# Discord Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_TEST_CHANNEL_ID=your_discord_channel_id

# Optional: Use same channel as production
# DISCORD_PR_CHANNEL_ID=your_discord_channel_id

# Test Configuration
E2E_TEST_PREFIX=e2e-test
E2E_CLEANUP=true
E2E_TIMEOUT=300000
E2E_WORKFLOW_TIMEOUT=300000
E2E_DISCORD_POLL_INTERVAL=2000
E2E_DISCORD_POLL_TIMEOUT=120000

# Optional: Test reviewers (comma-separated GitHub usernames)
# Required for tests 3, 5-12
E2E_TEST_REVIEWERS=reviewer1,reviewer2,reviewer3
```

### 3. GitHub Secrets

Ensure the following secrets are configured in your GitHub repository:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PR_CHANNEL_ID`
- `DISCORD_USER_MAPPING` (optional)
- `DISCORD_OPERATIONS_ROLE_ID` (optional)

## Running Tests

### Run All E2E Tests

```bash
npm run test:e2e
```

### Run Individual Test

Run a specific test by name:

```bash
npm run test:e2e -- -t "PR Opened Draft"
```

Run tests matching a pattern:

```bash
npm run test:e2e -- -t "opened"
```

### Watch Mode

```bash
npm run test:e2e:watch
```

## Test Scenarios

The E2E test suite includes 15 test scenarios:

1. **PR Opened (Draft)** - Verifies Discord message for draft PR
2. **PR Opened (Ready)** - Verifies warning message for PR without reviewers
3. **PR Opened (Multiple Reviewers)** - Verifies all reviewers are listed (requires `E2E_TEST_REVIEWERS`)
4. **Draft → Ready** - Verifies status update when draft is marked ready
5. **Reviewer Added** - Verifies thread message when reviewer is added (requires `E2E_TEST_REVIEWERS`)
6. **Reviewer Removed** - Verifies update when reviewer is removed (requires `E2E_TEST_REVIEWERS`)
7. **Review Approved** - Verifies ✅ reaction and status update (requires `E2E_TEST_REVIEWERS`)
8. **Changes Requested** - Verifies ❌ reaction and status update (requires `E2E_TEST_REVIEWERS`)
9. **Review Comment Only** - Verifies no action for comment-only reviews (requires `E2E_TEST_REVIEWERS`)
10. **Review Dismissed** - Verifies status reset when changes requested is dismissed (requires `E2E_TEST_REVIEWERS`)
11. **Review Dismissed (Approved)** - Verifies skip when approved review is dismissed (requires `E2E_TEST_REVIEWERS`)
12. **PR Synchronize (After Approval)** - Verifies unlock and reset after new commits (requires `E2E_TEST_REVIEWERS`)
13. **PR Synchronize (No Approval)** - Verifies skip for PRs without approval
14. **PR Closed** - Verifies thread lock and status update
15. **PR Merged** - Verifies 🎉 reaction, thread archive, and status update

## Incremental Development

Tests are designed to be implemented and verified one at a time:

1. Implement a test
2. Run it individually: `npm run test:e2e -- -t "Test Name"`
3. Debug and fix any issues
4. Verify it passes consistently
5. Move to the next test

Once all tests are implemented and verified, run the full suite.

## Test Isolation

- Each test creates its own unique PR
- Each test cleans up its own resources
- Tests can be run in any order
- Tests don't depend on each other

## Cleanup

Tests automatically clean up PRs and branches after execution. If cleanup fails or tests are interrupted, you may need to manually clean up:

1. Close any open test PRs
2. Delete test branches (prefixed with `e2e-test-`)
3. Optionally delete Discord messages (if bot has permissions)

## Troubleshooting

### Tests Timeout

- Increase `E2E_TIMEOUT` and `E2E_WORKFLOW_TIMEOUT` values
- Check GitHub Actions workflow execution time
- Verify network connectivity

### Discord Messages Not Found

- Verify `DISCORD_TEST_CHANNEL_ID` is correct
- Check bot has access to the channel
- Increase `E2E_DISCORD_POLL_TIMEOUT`
- Check Discord API rate limits

### Workflow Not Triggering

- Verify workflow is enabled in repository
- Check workflow file syntax
- Verify GitHub token has correct permissions
- Check workflow run logs in GitHub Actions

### Rate Limiting

- Tests include delays to respect rate limits
- If hitting limits, reduce test frequency
- Consider using a separate test repository

### Reviewer Tests Failing

- Ensure `E2E_TEST_REVIEWERS` is configured
- Verify reviewers are valid GitHub usernames
- Check reviewers have access to the repository

## Best Practices

1. **Use a Dedicated Test Repository**: Avoid running E2E tests on production repositories
2. **Use a Dedicated Discord Channel**: Isolate test messages from production
3. **Run Tests During Off-Hours**: Reduce impact on rate limits and workflows
4. **Monitor Test Results**: Track flaky tests and investigate failures
5. **Keep Tests Updated**: Update tests when system behavior changes

## CI/CD Integration

E2E tests can be integrated into CI/CD pipelines:

- Run on schedule (e.g., nightly)
- Run on PR to main branch
- Store test results as artifacts
- Use separate test repository for CI

See `.github/workflows/e2e-tests.yaml` for example CI workflow.

## Limitations

- Tests require live GitHub and Discord instances
- Tests are slower than unit/integration tests
- Tests may be affected by rate limiting
- Tests require proper environment setup
- Some tests require additional configuration (reviewers)

## Support

For issues or questions:

1. Check this documentation
2. Review test logs and error messages
3. Check GitHub Actions workflow logs
4. Verify environment configuration
5. Check Discord bot permissions
