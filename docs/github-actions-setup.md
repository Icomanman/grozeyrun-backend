# GitHub Actions Setup Guide

This guide walks you through setting up automated Edge Functions deployment via GitHub Actions.

## Prerequisites

- [ ] Supabase project created and configured
- [ ] GitHub repository with the backend code
- [ ] Admin access to both Supabase and GitHub

## Step 1: Gather Supabase Credentials

You'll need several pieces of information from Supabase. Open your [Supabase Dashboard](https://app.supabase.com).

### 1.1 Get Your Project ID

1. Go to **Project Settings** (gear icon)
2. Under **General**, find **Project ID** (looks like: `abcdefghijklmnop`)
3. **Copy and save this** — you'll need it for `SUPABASE_PROJECT_ID`

### 1.2 Get Your API Keys and URL

1. Go to **Project Settings** → **API**
2. You'll see:
   - **Project URL** — copy this for `SUPABASE_URL` (e.g., `https://abcdefghijklmnop.supabase.co`)
   - **Service Role Key** (under "Service Role") — copy this for `SUPABASE_SERVICE_ROLE_KEY`
     - ⚠️ **KEEP THIS SECRET!** It has full database access!

### 1.3 Create a Personal Access Token

1. Click your **Profile** icon (top-right)
2. Go to **Account Settings**
3. Navigate to **Access Tokens** in the left sidebar
4. Click **Create a new token**
5. Name it something like `GitHub Actions Deployment`
6. Set expiration (e.g., 90 days or No expiration)
7. Click **Create Token**
8. **Copy the token immediately** — you won't see it again!
9. Save this for `SUPABASE_ACCESS_TOKEN`

### 1.4 Database Password (Optional)

If you need this for migrations, go to **Project Settings** → **Database** and look for the database password. This is optional for the current workflow.

## Step 2: Configure GitHub Secrets

Now add these secrets to your GitHub repository:

### 2.1 Open Repository Settings

1. Go to your GitHub repository
2. Click **Settings** (top-right, next to About)
3. In the left sidebar, click **Secrets and variables** → **Actions**

### 2.2 Add Each Secret

Click **New repository secret** for each of these:

| Secret Name | Value | Notes |
|-------------|-------|-------|
| `SUPABASE_PROJECT_ID` | Your Project ID from 1.1 | Format: alphanumeric string |
| `SUPABASE_URL` | Your Project URL from 1.2 | Format: `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key from 1.2 | ⚠️ Keep this confidential! |
| `SUPABASE_ACCESS_TOKEN` | Token from 1.3 | ⚠️ Keep this confidential! |
| `SUPABASE_DB_PASSWORD` | Database password (optional) | Leave blank if not needed |

**Example: Adding `SUPABASE_URL`**

1. Click **New repository secret**
2. **Name**: `SUPABASE_URL`
3. **Secret**: `https://abcdefghijklmnop.supabase.co`
4. Click **Add secret**

Repeat for all secrets.

## Step 3: Verify the Workflow File

Check that the workflow file exists:

```bash
ls -la .github/workflows/deploy-edge-functions.yml
```

If it doesn't exist, it was created by the build script. Verify its contents look correct.

## Step 4: Test the Workflow

### 4.1 Trigger Manually

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **Deploy Edge Functions** workflow
4. Click **Run workflow** → **Run workflow** button

This will run without any code changes, useful for testing your secrets.

### 4.2 Check the Logs

1. The workflow should start running
2. Click on the running workflow to see logs
3. Watch for these steps:
   - ✅ Checkout code
   - ✅ Set up Node.js
   - ✅ Install dependencies
   - ✅ Build Edge Functions
   - ✅ Set up Supabase CLI
   - ✅ Deploy Edge Functions
   - ✅ Verify deployment

If any step fails, the error message will show you what went wrong.

### 4.3 Common Errors & Solutions

**Error: `Invalid credentials`**
- ❌ Your secrets are incorrect or expired
- ✅ Double-check the values in GitHub Settings
- ✅ Re-create the Supabase Access Token if it expired

**Error: `Project not found` or `Authorization failed`**
- ❌ `SUPABASE_PROJECT_ID` is wrong
- ✅ Verify it matches your actual project ID

**Error: `Function deployment failed`**
- ❌ Check Supabase project has quota available
- ✅ Go to Supabase Console → Functions to see error details

## Step 5: Make Your First Deployment

Now make a real code change and push it:

```bash
# Make a small change to the backend
echo "# Updated on $(date)" >> app.cjs

# Commit and push
git add .
git commit -m "Test edge functions deployment"
git push origin main
```

This will trigger the workflow automatically. Watch it deploy your Edge Functions!

## Step 6: Verify in Supabase

Once the workflow completes:

1. Go to **Supabase Console** → **Functions**
2. You should see:
   - ✅ `sync-push`
   - ✅ `sync-pull`

Click each function to see:
- Deployment status
- Recent logs
- Invocation metrics

## Troubleshooting

### Workflow Doesn't Trigger on Push

Make sure your changes include files the workflow watches:
- `app.cjs`, `auth.cjs`, `db.cjs`, `services.cjs`, `validations.cjs`
- `package.json`
- `scripts/build-edge-functions.js`
- `.github/workflows/deploy-edge-functions.yml`

If changing other files, the workflow won't run. You can manually trigger it or edit the workflow's `paths` filter.

### "Function already exists" Error

This is normal — the workflow overwrites existing functions with new versions. It's not an error.

### Need to Test Locally First?

Before committing, you can test the build locally:

```bash
npm run build:edge
ls supabase/functions/
```

This generates the Edge Functions locally without deploying them.

## Next Steps

- ✅ Set up automated deployments for both `main` and `develop` branches
- ✅ Test that the mobile app can call the Edge Functions endpoints
- ✅ Monitor Edge Function logs in Supabase Console
- ✅ Set up alerts for errors (Supabase has monitoring options)

## Security Best Practices

1. **Rotate tokens periodically**
   - GitHub Secrets: Regenerate Access Token every 90 days
   - Check token expiration in Supabase Account Settings

2. **Restrict token permissions**
   - Access Token: Create with minimal necessary permissions
   - Service Role Key: Use only for this automation

3. **Audit logs**
   - GitHub: Check Actions logs for any suspicious activity
   - Supabase: Review function deployment history

4. **Protect branch**
   - Consider requiring PR reviews before deploying to `main`
   - Use branch protection rules in GitHub

---

Still stuck? Check:
- [Supabase Documentation](https://supabase.com/docs)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- Workflow logs for detailed error messages
