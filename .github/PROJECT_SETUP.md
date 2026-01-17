# Project Assignment Setup Instructions

## Step 1: Find Your Project Number

1. Navigate to your GitHub Project in your browser
2. Look at the URL - it will look like one of these:
   - **Organization project**: `https://github.com/orgs/YOUR_ORG/projects/1`
   - **User project**: `https://github.com/users/YOUR_USERNAME/projects/2`
3. The number after `/projects/` is your project number (e.g., `1` or `2`)

## Step 2: Add Project Number as Repository Secret

1. Go to your repository on GitHub
2. Click **Settings** (top navigation bar)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Name: `PROJECT_NUMBER`
6. Value: Enter the project number you found in Step 1 (just the number, e.g., `1`)
7. Click **Add secret**

## Step 3: Verify Permissions

Make sure your GitHub Actions workflow has the necessary permissions:
- The workflow already includes `project: write` permission in `add-to-default-project.yaml`
- The `GITHUB_TOKEN` (automatically provided) needs access to the project

**Note**: If the project belongs to an organization:
- Organization settings may need to allow GitHub Actions to access organization projects
- Go to **Organization Settings** → **Actions** → **General** → **Workflow permissions**
- Ensure "Read and write permissions" is enabled for organization projects

## Testing

Once configured, test by creating a new issue using the Bug Report form. The issue should automatically be added to your project after creation.

## Troubleshooting

- **"Project not found"**: Double-check the project number in the URL
- **"Permission denied"**: Verify the `project: write` permission and organization workflow permissions
- **"Skipping project assignment"**: The secret may not be set - verify `PROJECT_NUMBER` exists in repository secrets
