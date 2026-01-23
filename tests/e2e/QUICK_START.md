# E2E Tests Quick Start Guide

This is a quick guide to get you started with E2E tests.

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Run Setup Script

The setup script will guide you through configuring all required environment variables:

```bash
npm run test:e2e:setup
```

This interactive script will:
- Check your current configuration
- Guide you through setting up required variables
- Create a `.env` file with your configuration

## Step 3: Gather Required Information

Before running the setup script, you'll need:

### GitHub Authentication

You can use either a **Personal Access Token (PAT)** or a **GitHub App** (recommended).

#### Option 1: GitHub App (Recommended)

GitHub App is recommended for better security, scalability, and independence from user accounts.

**Create a GitHub App:**
1. Go to https://github.com/settings/apps/new
   - **Important**: Make sure you're creating a "GitHub App" (not an "OAuth App")
   - The page should say "New GitHub App" at the top
   - If you see "Authorization callback URL" or "Client ID/Secret", you're on the OAuth App page - use the GitHub App page instead
2. Fill in:
   - **Name**: Your app name (e.g., "E2E Test Bot")
   - **Homepage URL**: Your repository URL
   - **Webhook**: Leave unchecked (not needed for e2e tests)
3. Set permissions:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Issues**: Read
   - **Actions**: Read
4. Click "Create GitHub App"
5. On the app page:
   - Copy the **App ID** (number)
   - Click "Generate a private key" and save the `.pem` file
6. Install the app on your repository:
   - Click "Install App"
   - Select your repository
   - Click "Install"
   - Note the **Installation ID** from the URL (optional - will be auto-discovered if not provided)

**You'll need:**
- `GITHUB_APP_ID`: The App ID (number)
- `GITHUB_APP_PRIVATE_KEY`: The private key (PEM format or base64-encoded)
- `GITHUB_APP_INSTALLATION_ID`: Optional - will be auto-discovered if not provided

#### Option 2: Personal Access Token

**Classic Token:**
- Go to https://github.com/settings/tokens
- Click "Generate new token" → "Generate new token (classic)"
- Select `repo` scope
- Copy the token (starts with `ghp_`)

**Fine-grained Token:**
- Go to https://github.com/settings/tokens
- Click "Generate new token" → "Generate new token (fine-grained)"
- Select your repository
- Set permissions:
  - **Contents**: Read and write
  - **Pull requests**: Read and write
  - **Issues**: Read
  - **Actions**: Read
- Copy the token (starts with `github_pat_`)

**You'll need:**
- `GITHUB_TOKEN`: Your Personal Access Token

#### Repository Information
- **Repository Owner**: Your GitHub username or organization name
- **Repository Name**: The name of your test repository

### Discord
- **Bot Token**: 
  - Go to https://discord.com/developers/applications
  - Select your bot application
  - Go to "Bot" section
  - Copy the token

- **Channel ID**: 
  - Enable Developer Mode in Discord (User Settings → Advanced)
  - Right-click on the channel
  - Click "Copy ID"

### Optional: Test Reviewers
- **GitHub Usernames**: Comma-separated list of GitHub usernames for testing reviewer scenarios
  - Example: `reviewer1,reviewer2,reviewer3`
  - Required for tests 3, 5-12

## Step 4: Verify Configuration

After running the setup script, check your `.env` file:

```bash
cat .env
```

Make sure all required values are set correctly.

## Step 5: Test Your Setup

Run a simple test to verify everything works:

```bash
# Run Test 1 only (recommended) - WITH cleanup
npm run test:e2e:single 1

# Run Test 1 WITHOUT cleanup (to inspect results)
npm run test:e2e:single:no-cleanup 1

# Or use vitest directly with exact match
npx vitest run tests/e2e -t "Test 1:"
```

This will:
1. Create a test PR in your repository
2. Wait for the workflow to run
3. Check that a Discord message was created
4. Clean up the test PR (unless using `:no-cleanup` variant)

**Important:** Always run tests one at a time. See `tests/e2e/RUNNING_TESTS.md` for details.

### Running Tests Without Cleanup

If you want to inspect the results in Discord and GitHub before cleanup:

```bash
# Run a single test without cleanup
npm run test:e2e:single:no-cleanup 1

# Run all tests without cleanup
npm run test:e2e:no-cleanup
```

After inspecting, manually clean up:

```bash
# Clean up all test resources (GitHub PRs, branches, Discord messages/threads)
npm run test:e2e:cleanup
```

## Troubleshooting

### "Environment variable X is required"
- Make sure your `.env` file exists and contains the variable
- Check for typos in variable names
- Ensure values don't have extra spaces

### "GitHub API error: 401"
- Verify your GitHub token is valid
- Check that the token has `repo` scope
- Make sure the token hasn't expired

### "Discord API error: 401"
- Verify your Discord bot token is correct
- Check that the bot hasn't been deleted or reset

### "Channel not found"
- Verify the Discord channel ID is correct
- Check that the bot has access to the channel
- Ensure Developer Mode is enabled when copying the ID

### "Workflow did not complete"
- Check that the Discord PR Notifications workflow is enabled in your repository
- Verify the workflow file exists at `.github/workflows/discord-pr-notifications.yaml`
- Check GitHub Actions tab for workflow runs

## Next Steps

Once your first test passes:
1. Run the next test: `npm run test:e2e:single 2`
2. Continue one test at a time: `npm run test:e2e:single 3`, etc.
3. Once all tests are verified individually, you can run all: `npm run test:e2e`
4. Check the full documentation: `docs/E2E_TESTING.md`
5. See `tests/e2e/RUNNING_TESTS.md` for detailed running instructions

## Available Commands

### Running Tests
- `npm run test:e2e` - Run all E2E tests (with cleanup)
- `npm run test:e2e:no-cleanup` - Run all E2E tests (without cleanup)
- `npm run test:e2e:single <number>` - Run a single test (with cleanup)
- `npm run test:e2e:single:no-cleanup <number>` - Run a single test (without cleanup)

### Cleanup
- `npm run test:e2e:cleanup` - Manually clean up all test resources (GitHub PRs, branches, Discord messages/threads)

## Need Help?

- Check `docs/E2E_TESTING.md` for detailed documentation
- Review test logs for specific error messages
- Check GitHub Actions workflow logs
- Verify Discord bot permissions
