# Running E2E Tests - One at a Time

## Running a Single Test

To run **only one test** at a time, use the exact test number:

```bash
# Run only Test 1
npx vitest run tests/e2e -t "Test 1:"

# Run only Test 2
npx vitest run tests/e2e -t "Test 2:"

# Run only Test 3
npx vitest run tests/e2e -t "Test 3:"
```

**Important:** Use the format `"Test X:"` with the colon to ensure only that specific test runs.

## Why Tests Must Run One at a Time

1. **Rate Limiting**: GitHub and Discord APIs have rate limits
2. **Resource Conflicts**: Multiple tests creating PRs simultaneously can interfere
3. **Cleanup**: Each test needs to clean up before the next one starts
4. **Debugging**: Easier to debug when tests run sequentially

## Test Execution Flow

When you run a single test:

1. Test creates a unique PR (with timestamp/random ID)
2. Test waits for GitHub Actions workflow to complete
3. Test verifies Discord message was created/updated
4. Test cleans up the PR and branch automatically
5. **Only then** should you run the next test

## Cleanup

### Automatic Cleanup

Tests automatically clean up PRs and branches after execution (if `E2E_CLEANUP=true` in `.env`).

### Manual Cleanup

If tests are interrupted or cleanup fails, use the cleanup script:

```bash
npm run test:e2e:cleanup
```

This will:
- Find all open PRs with `[E2E]` in the title or branches starting with `e2e-test-`
- Close those PRs
- Delete those branches

## Troubleshooting

### All Tests Running at Once

If multiple tests run when you only want one:

1. Use the exact format: `-t "Test 1:"` (with colon)
2. Check that other tests are properly skipped
3. Verify you're in the correct directory

### PRs Not Cleaning Up

1. Check `E2E_CLEANUP` is set to `true` in `.env`
2. Run manual cleanup: `npm run test:e2e:cleanup`
3. Check GitHub API rate limits
4. Verify your token has delete permissions

### Discord Messages Accumulating

Discord messages are not automatically deleted (bot may not have permission). You can:
1. Manually delete test messages in Discord
2. Use a dedicated test channel that can be cleared periodically
3. Add message deletion to cleanup script (requires bot permissions)

## Best Practices

1. **Run one test at a time** - Don't run multiple tests simultaneously
2. **Wait for cleanup** - Let each test finish and clean up before starting the next
3. **Check results** - Verify each test passes before moving to the next
4. **Use cleanup script** - Run `npm run test:e2e:cleanup` if you see orphaned PRs
5. **Monitor rate limits** - Check GitHub/Discord API rate limit headers if tests fail
