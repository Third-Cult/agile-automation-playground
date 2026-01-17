---
name: Bug Template System
overview: Create a comprehensive bug reporting system with a single unified issue template that accommodates both quick bug reports and detailed QA documentation, with automatic labeling via template metadata and GitHub Actions workflows, and validation workflows for bug reports.
todos: []
---

# Bug Template System Implementation Plan

## Overview

Create a bug reporting system with a single unified GitHub issue template that serves both casual users and QA team members. The template includes required fields for essential information and optional fields for comprehensive documentation. The template will automatically apply the "type: BUG" label using the repository's label naming convention (type prefixes) via template metadata and GitHub Actions workflows.

## Files to Create

### 1. Issue Templates (`.github/ISSUE_TEMPLATE/`)

#### `bug_report.yaml` - GitHub Issue Form (Not Markdown Template)

- **GitHub Issue Form** using YAML format (structured form with fields, not a simple markdown template)
- Single form that accommodates both quick reports and comprehensive QA documentation
- Users see a structured form interface with labeled fields, dropdowns, and text inputs
- **Required fields** (for everyone): description, steps to reproduce, expected behavior, actual behavior
- **Optional but recommended fields**: environment
- **Optional detailed fields** (for QA): screenshots, logs/error messages, reproducibility rating, impact description, related issues, additional context
- Form metadata includes `labels: ["type: BUG"]` for automatic labeling on submission (using "type:" prefix naming convention)
- Clear field descriptions and placeholders guide users on what to include

### 2. GitHub Actions Workflows (`.github/workflows/`)

#### `ticket-creation.yaml` - Main Entry Point Workflow

- Triggers on `issues.opened` event (single entry point for all ticket types)
- Detects ticket type by checking labels (using "type:" prefix convention) or template metadata
- Routes to appropriate sub-workflows based on ticket type label:
  - If "type: BUG" label → calls `validate-bug-report.yaml`
  - If "type: STORY" or "type: FEATURE" label → calls `validate-feature-request.yaml` (if exists)
- Calls `add-labels.yaml` reusable workflow to ensure proper labeling
- Calls `add-to-default-project.yaml` to add issues to project board
- Single source of truth for ticket creation automation

#### `validate-bug-report.yaml` - Reusable Bug Validation Workflow

- Reusable workflow called by `ticket-creation.yaml` for issues with "type: BUG" label
- Validates required fields are filled in bug reports
- Checks for minimum viable information (description, steps, expected, actual)
- Posts helpful comments if validation fails
- Manages validation status labels (e.g., "needs-info", "valid")
- Can be called from other workflows if needed (e.g., on issue edits)

#### `add-labels.yaml` - Reusable Label Workflow

- Reusable workflow for adding labels to issues/PRs
- Called by `ticket-creation.yaml` and potentially other workflows
- Validates label existence and applies labels
- Designed to be reusable across all ticket types

#### `add-to-default-project.yaml` - Reusable Project Assignment Workflow

- Reusable workflow for adding issues to default GitHub Project board
- Called by `ticket-creation.yaml`
- Works for all ticket types

## Implementation Details

### Issue Form Structure

The form will use GitHub's Issue Form YAML format (not markdown template format) with:

- `name`: Form display name shown in GitHub's issue creation menu
- `description`: Brief form description
- `labels`: Array including "type: BUG" for automatic labeling when form is submitted
- `body`: Array of form fields with types:
  - `textarea` - Multi-line text inputs
  - `input` - Single-line text inputs  
  - `dropdown` - Select menus (for reproducibility, severity, etc.)
  - `markdown` - Text-only sections for instructions/guidance
- Each field includes `label`, `description`, `placeholder` text, and `required` flag
- Required vs. optional fields clearly marked in the form interface

### Workflow Automation Flow

```
Issue Created (any template)
  └─> ticket-creation.yaml (triggers on issues.opened)
      ├─> Detects ticket type (bug, feature request, etc.)
      ├─> Calls add-labels.yaml (ensures "type: BUG" label + any others)
      ├─> Calls add-to-default-project.yaml (adds to project board)
      └─> Routes to type-specific validation:
          └─> If "type: BUG" label present → calls validate-bug-report.yaml
              ├─> Validates required fields
              ├─> Posts comment if validation fails
              └─> Applies validation status labels
```

This modular approach allows:
- Single entry point for all ticket types (easier to maintain)
- Reusable validation workflows per ticket type (easy to extend)
- Consistent labeling and project assignment across all tickets
- Easy to add new ticket types by extending `ticket-creation.yaml`

### Field Specifications

**Required Fields (everyone must fill):**

- Description/Title (textarea) - clear summary of the bug
- Steps to reproduce (textarea) - numbered steps to reproduce the issue
- Expected behavior (textarea) - what should happen
- Actual behavior (textarea) - what actually happens

**Optional but Recommended:**

- Environment (input) - OS, browser, device, version info, etc.

**Optional Detailed Fields (for comprehensive QA documentation):**

- Screenshots (markdown hint/instructions) - guidance on attaching screenshots
- Logs/Error messages (textarea) - stack traces, console errors, application logs
- Reproducibility (dropdown: Always, Sometimes, Rarely, Once) - how often the bug occurs
- Impact description (textarea) - business/user impact, workarounds
- Related issues (input) - links to related tickets or issues
- Additional context (textarea) - any other relevant information

The template will include helpful placeholders and descriptions to guide users on what to include in optional fields without making them feel required.

## Label Naming Convention

- Uses "type:" prefix for issue type labels (e.g., "type: BUG", "type: STORY")
- GitHub fully supports colons in label names - this is a common organizational pattern
- Labels are case-sensitive and preserved exactly as created
- This convention allows easy filtering and categorization in workflows
- Other label categories can follow similar patterns (e.g., "priority:", "area:", "status:")

## Dependencies

- No existing templates or workflows to modify
- Directories already exist: `.github/ISSUE_TEMPLATE/` and `.github/workflows/`
- Starting fresh with modular, reusable workflow architecture
- Label "type: BUG" must be created in the repository before automation will work (can be done via GitHub UI or API)

## Testing Considerations

- Test template creation and form rendering
- Verify automatic label application
- Test workflow triggers and validation logic
- Test with minimal required fields only (casual user scenario)
- Test with all fields filled (QA comprehensive scenario)
- Verify validation correctly identifies missing required fields without blocking on optional fields
