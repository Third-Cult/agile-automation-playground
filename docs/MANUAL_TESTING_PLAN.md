# Manual Testing Plan for Discord PR Notifications

This document provides step-by-step instructions for manually testing the Discord PR notifications system in a real GitHub repository.

## Prerequisites

Before starting, ensure you have:

1. **GitHub Repository**: A test repository with the workflow enabled
2. **Discord Server**: A test Discord server with:
   - Bot added and configured
   - Channel ID for PR notifications
   - Bot has permissions to:
     - Send messages
     - Create threads
     - Edit messages
     - Add reactions
     - Lock/unlock threads
     - Archive threads
3. **GitHub Secrets Configured**:
   - `DISCORD_BOT_TOKEN`: Discord bot token
   - `DISCORD_PR_CHANNEL_ID`: Channel ID for PR notifications
   - `DISCORD_USER_MAPPING`: JSON mapping of GitHub usernames to Discord user IDs
   - `DISCORD_OPERATIONS_ROLE_ID`: (Optional) Role ID for operations team
4. **Test Users**: At least 2-3 GitHub accounts for testing reviewer scenarios

## Test Scenarios

### Test 1: PR Opened (Draft with Reviewers) -

**Steps:**
1. Create a new branch: `test-draft-pr`
2. Make a small change (e.g., add a comment to a file)
3. Open a Pull Request:
   - Title: "Test Draft PR with Reviewers"
   - Description: "This is a test PR to verify draft PR notifications"
   - Mark as **Draft**
   - Add at least one reviewer
4. Submit the PR

**Expected Results:**
- [ ] Discord message appears in the configured channel
- [ ] Message shows:
  - PR number and title
  - Branch information (feature → main)
  - Author mention (Discord mention if mapped, otherwise @username)
  - Reviewers listed (Discord mentions if mapped)
  - Status: ":pencil: Draft - In Progress"
- [ ] Thread created from the message
- [ ] Thread contains: ":thread: Keep all conversations/dialogue about the contents of the PR in this thread **or** in the PR's comments"
- [ ] Hidden metadata comment added to PR (check PR comments)

**Verification:**
- Check Discord channel for the message
- Check PR comments for hidden metadata comment (starts with `<!-- DISCORD_BOT_METADATA`)
- Verify thread was created

---

### Test 2: PR Opened (Ready without Reviewers)

**Steps:**
1. Create a new branch: `test-ready-no-reviewers`
2. Make a small change
3. Open a Pull Request:
   - Title: "Test Ready PR No Reviewers"
   - Description: "Testing ready PR without reviewers"
   - Do NOT mark as Draft
   - Do NOT add reviewers
4. Submit the PR

**Expected Results:**
- [ ] Discord message appears
- [ ] Message shows:
  - Status: ":eyes: Ready for Review"
  - Warning message: "WARNING::No reviewers assigned:"
  - Warning text: "PR has to be reviewed by another member before merging."
- [ ] Thread created
- [ ] Metadata saved

**Verification:**
- Check for warning message in Discord
- Verify no reviewers section or warning is displayed

---

### Test 3: PR Opened (Ready with Multiple Reviewers)

**Steps:**
1. Create a new branch: `test-ready-multiple-reviewers`
2. Make a small change
3. Open a Pull Request:
   - Title: "Test Ready PR Multiple Reviewers"
   - Add 2-3 reviewers
   - Do NOT mark as Draft
4. Submit the PR

**Expected Results:**
- [ ] Discord message appears
- [ ] All reviewers are listed in the message
- [ ] Reviewers are mentioned (Discord mentions if mapped)
- [ ] Status: ":eyes: Ready for Review"
- [ ] No warning about missing reviewers

**Verification:**
- Verify all reviewers appear in the message
- Check that Discord mentions work for mapped users

---

### Test 4: Draft PR → Ready for Review

**Steps:**
1. Use the draft PR from Test 1 (or create a new draft PR)
2. In GitHub, click "Ready for review" button
3. Wait for workflow to complete

**Expected Results:**
- [ ] Discord parent message status updated from "Draft - In Progress" to ":eyes: Ready for Review"
- [ ] Thread message posted: ":eyes: This PR is now ready for review!"
- [ ] No errors in GitHub Actions workflow

**Verification:**
- Check Discord message was edited (status changed)
- Check thread for the ready-for-review message
- Verify workflow completed successfully

---

### Test 5: Reviewer Added

**Steps:**
1. Use a PR from previous tests (or create a new one)
2. In GitHub PR, click "Reviewers" → "Request review"
3. Add a reviewer who wasn't previously assigned
4. Wait for workflow to complete

**Expected Results:**
- [ ] Thread message posted mentioning the newly added reviewer
- [ ] Message format: ":bellhop: @reviewer - your review has been requested for [PR #X](url)"
- [ ] Parent Discord message updated with ALL current reviewers (not just the new one)
- [ ] Reviewer list in parent message is accurate

**Verification:**
- Check thread for reviewer mention
- Verify parent message shows all reviewers
- Check that the specific reviewer who was added is mentioned in thread

---

### Test 6: Reviewer Removed

**Steps:**
1. Use a PR with multiple reviewers
2. In GitHub PR, remove one reviewer
3. Wait for workflow to complete

**Expected Results:**
- [ ] Thread message posted: "👋 @reviewer has been removed as a reviewer from this PR."
- [ ] Reviewer removed from Discord thread (if they were in the thread and mapped)
- [ ] Parent Discord message updated with remaining reviewers
- [ ] Removed reviewer no longer appears in parent message

**Verification:**
- Check thread for removal message
- Verify parent message reviewer list updated
- If reviewer was in thread, verify they were removed (may require checking Discord directly)

---

### Test 7: Review Submitted (Approved)

**Steps:**
1. Use a PR that's ready for review
2. As a reviewer, submit a review:
   - Select "Approve"
   - Optionally add a review comment
3. Submit the review
4. Wait for workflow to complete

**Expected Results:**
- [ ] ✅ reaction added to Discord parent message
- [ ] ❌ reaction removed if it was present
- [ ] Thread message posted:
  - Format: ":white_check_mark: @author - @reviewer has approved the PR"
  - Review body included if provided (as blockquote)
  - "Feel free to merge if all other conditions have been met"
- [ ] Parent message status updated: "**Status**: :white_check_mark: Approved by @reviewer"
- [ ] Thread locked (no new messages can be posted)

**Verification:**
- Check Discord message for ✅ reaction
- Verify status line updated in parent message
- Check thread for approval message
- Try to post in thread (should be locked)
- Verify review body appears if provided

---

### Test 8: Review Submitted (Changes Requested)

**Steps:**
1. Use a PR that's ready for review
2. As a reviewer, submit a review:
   - Select "Request changes"
   - Add a comment explaining what needs to be fixed
3. Submit the review
4. Wait for workflow to complete

**Expected Results:**
- [ ] ❌ reaction added to Discord parent message
- [ ] ✅ reaction removed if it was present
- [ ] Thread message posted:
  - Format: ":tools: @author - changes have been requested by @reviewer."
  - Review body included (as blockquote)
  - "Please resolve them and re-request a review."
- [ ] Parent message status updated: "**Status**: :tools: Changes Requested by @reviewer"
- [ ] Thread remains unlocked

**Verification:**
- Check Discord message for ❌ reaction
- Verify status line updated
- Check thread for changes requested message
- Verify review body appears
- Confirm thread is still unlocked

---

### Test 9: Review Submitted (Comment Only)

**Steps:**
1. Use a PR that's ready for review
2. As a reviewer, submit a review:
   - Select "Comment" (not Approve or Request changes)
   - Add a comment
3. Submit the review
4. Wait for workflow to complete

**Expected Results:**
- [ ] No reaction added to Discord message
- [ ] No thread message posted
- [ ] No status update in parent message
- [ ] Workflow completes but handler skips processing

**Verification:**
- Check that no Discord activity occurred
- Verify workflow logs show "Review is just a comment, skipping."

---

### Test 10: Review Dismissed (Changes Requested)

**Steps:**
1. Use a PR that has "Changes Requested" status (from Test 8)
2. As the PR author or maintainer, dismiss the review
3. Wait for workflow to complete

**Expected Results:**
- [ ] Thread message posted: "✅ @reviewer The requested changes have been addressed. Please review the updates."
- [ ] Parent message status updated back to ":eyes: Ready for Review"
- [ ] Workflow completes successfully

**Verification:**
- Check thread for dismissal message
- Verify status reset to "Ready for Review"
- Check that reviewer is mentioned

---

### Test 11: Review Dismissed (Approved) - Should Skip

**Steps:**
1. Use a PR that has "Approved" status (from Test 7)
2. Dismiss the approved review
3. Wait for workflow to complete

**Expected Results:**
- [ ] No thread message posted
- [ ] No status update
- [ ] Workflow logs show: "Dismissed review was not changes_requested, skipping."

**Verification:**
- Check that no Discord activity occurred
- Verify workflow logs show skip message

---

### Test 12: PR Synchronize (New Commits After Approval)

**Steps:**
1. Use a PR that was previously approved (from Test 7)
2. Make a new commit to the PR branch
3. Push the commit
4. Wait for workflow to complete

**Expected Results:**
- [ ] Thread unlocked (if it was locked)
- [ ] Parent message status updated from "Approved" to ":eyes: Ready for Review"
- [ ] Thread message posted:
  - If reviewers exist: "⚠️ New commits have been pushed to this PR. @reviewers Please review the updates."
  - If no reviewers: "⚠️ New commits have been pushed to this PR. Please add reviewers if needed."
- [ ] Reviews re-requested on GitHub (check PR for review requests)
- [ ] Workflow completes successfully

**Verification:**
- Check thread is unlocked (try posting a message)
- Verify status reset to "Ready for Review"
- Check thread for synchronize message
- Verify reviewers were re-requested on GitHub PR
- Check that reviewers are mentioned in thread message

---

### Test 13: PR Synchronize (New Commits Without Approval) - Should Skip

**Steps:**
1. Use a PR that is NOT approved (e.g., "Ready for Review" or "Changes Requested")
2. Make a new commit to the PR branch
3. Push the commit
4. Wait for workflow to complete

**Expected Results:**
- [ ] No Discord activity (no status update, no thread message)
- [ ] Workflow completes but handler doesn't process (only processes if previously approved)

**Verification:**
- Check that no Discord activity occurred
- Verify workflow logs show handler ran but didn't process

---

### Test 14: PR Closed (Not Merged)

**Steps:**
1. Use any open PR
2. Close the PR without merging
3. Optionally add a closing comment
4. Wait for workflow to complete

**Expected Results:**
- [ ] Thread message posted:
  - Format: ":closed_book: [PR #X](url) has been closed by @closer"
  - Closing comment included if provided (and recent)
- [ ] Thread locked
- [ ] Parent message status updated: ":closed_book: Closed by @closer"
- [ ] Workflow completes successfully

**Verification:**
- Check thread for close message
- Verify thread is locked (try posting)
- Check parent message status updated
- Verify closing comment appears if provided

---

### Test 15: PR Merged

**Steps:**
1. Use a PR that's ready to merge
2. Merge the PR (via merge button or command)
3. Wait for workflow to complete

**Expected Results:**
- [ ] 🎉 reaction added to Discord parent message
- [ ] Thread message posted:
  - Format: ":tada: @author - [PR #X](url) has been merged into `branch`"
  - Merge commit message included if available
  - "Remember to delete associative branch if it is no longer needed!"
- [ ] Thread archived and locked
- [ ] Parent message status updated: ":tada: Merged by @merger"
- [ ] Workflow completes successfully

**Verification:**
- Check Discord message for 🎉 reaction
- Verify thread is archived and locked
- Check thread for merge message
- Verify merge commit message appears if available
- Check parent message status updated
- Verify author and merger are mentioned

---

### Test 16: Edge Cases

#### 16a: Very Long PR Title
**Steps:**
1. Create a PR with a title that's 100+ characters
2. Submit the PR

**Expected Results:**
- [ ] Thread name is truncated to 100 characters
- [ ] Full title appears in Discord message
- [ ] No errors

#### 16b: PR with No Description
**Steps:**
1. Create a PR with empty/null description
2. Submit the PR

**Expected Results:**
- [ ] Discord message doesn't contain "null"
- [ ] Message displays correctly without description
- [ ] No errors

#### 16c: PR with Markdown/Emojis
**Steps:**
1. Create a PR with:
   - Title containing emojis: "🚀 Feature: Add new functionality"
   - Description with markdown, code blocks, mentions
2. Submit the PR

**Expected Results:**
- [ ] Markdown renders correctly in Discord
- [ ] Emojis display properly
- [ ] Code blocks formatted correctly
- [ ] No parsing errors

#### 16d: Multiple Reviewers Added Simultaneously
**Steps:**
1. Create a PR
2. Add multiple reviewers at once (or in quick succession)
3. Wait for workflows to complete

**Expected Results:**
- [ ] Each reviewer addition triggers workflow
- [ ] Parent message always shows ALL current reviewers
- [ ] No duplicate messages
- [ ] All reviewers mentioned in thread

#### 16e: User Mapping Edge Cases
**Steps:**
1. Create a PR with:
   - Author mapped in DISCORD_USER_MAPPING
   - Some reviewers mapped, some not
2. Submit the PR

**Expected Results:**
- [ ] Mapped users show as Discord mentions: `<@discord-id>`
- [ ] Unmapped users show as GitHub username: `@github-username`
- [ ] All users appear correctly

---

## Verification Checklist

After completing all tests, verify:

### Discord Channel
- [ ] All PR messages appear in correct channel
- [ ] Threads are created for each PR
- [ ] Messages are properly formatted
- [ ] Reactions work correctly
- [ ] Status updates reflect PR state accurately
- [ ] Threads lock/unlock appropriately
- [ ] Threads archive on merge

### GitHub PRs
- [ ] Metadata comments are added (hidden)
- [ ] Metadata comments contain correct Discord IDs
- [ ] Warning comments appear when metadata missing
- [ ] Reviews are re-requested after synchronize

### Workflow Logs
- [ ] All workflows complete successfully
- [ ] No unexpected errors
- [ ] Warnings logged for non-critical failures
- [ ] Errors logged for critical failures

### Error Scenarios
- [ ] Missing bot token fails gracefully
- [ ] Missing channel ID fails gracefully
- [ ] Missing metadata warns but doesn't crash
- [ ] API failures are handled appropriately

---

## Troubleshooting

### Discord Message Not Appearing
1. Check GitHub Actions workflow logs for errors
2. Verify `DISCORD_BOT_TOKEN` secret is set correctly
3. Verify `DISCORD_PR_CHANNEL_ID` secret is set correctly
4. Check bot has permissions in Discord channel
5. Verify workflow is triggered (check workflow runs)

### Thread Not Created
1. Check workflow logs for thread creation errors
2. Verify bot has "Create Public Threads" permission
3. Check if message was sent successfully
4. Look for warning in workflow logs

### Metadata Not Found
1. Check PR comments for hidden metadata comment
2. Verify metadata comment format is correct
3. Check if PR was opened before workflow was enabled
4. Look for warning comment in PR

### Reactions Not Working
1. Verify bot has "Add Reactions" permission
2. Check workflow logs for reaction errors
3. Verify emoji encoding is correct

### Status Not Updating
1. Check if metadata exists (required for updates)
2. Verify bot has "Manage Messages" permission
3. Check workflow logs for edit message errors
4. Verify message ID is correct in metadata

---

## Test Results Template

Use this template to track your test results:

```
Test #: [Number]
Date: [Date]
Tester: [Name]
PR URL: [Link]

Steps Completed: [✓/✗]
Expected Results: [✓/✗]
Issues Found: [Description]
Notes: [Any additional notes]
```

---

## Success Criteria

All tests pass if:
- ✅ All 15 main scenarios work correctly
- ✅ Edge cases handled appropriately
- ✅ Error scenarios fail gracefully
- ✅ No critical errors in workflow logs
- ✅ Discord messages are accurate and timely
- ✅ Thread management works correctly
- ✅ Status updates reflect PR state accurately
