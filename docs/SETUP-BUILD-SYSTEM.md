# Edge Functions Build System Setup

This guide walks you through setting up and using the automated build system to deploy your Node.js Express backend to Supabase Edge Functions.

## Overview

The build system consists of:
1. **Build Script** (`scripts/build-edge-functions.js`) — Converts your Express backend to Deno/TypeScript Edge Functions
2. **GitHub Actions Workflow** (`.github/workflows/deploy-edge-functions.yml`) — Automatically builds and deploys on push
3. **Generated Functions** (`supabase/functions/`) — Output directory (not committed to git)

## Local Setup

### 1. Prerequisites

Ensure you have the following installed:
- **Node.js** 20+ (`node --version`)
- **Supabase CLI** (`supabase --version`) — [Install guide](https://supabase.com/docs/guides/cli/getting-started)
- **Git** (for version control)

### 2. Install Dependencies

```bash
cd grozeyrun-backend
npm install
```

### 3. Build Locally

Generate Edge Functions from your Express backend:

```bash
npm run build:edge
```

This creates:
- `supabase/functions/sync-push/index.ts` — POST /api/sync (push)
- `supabase/functions/sync-pull/index.ts` — GET /api/sync (pull)

### 4. Test Locally (Optional)

Start the local Supabase Edge Functions environment:

```bash
supabase functions serve
```

Then test with curl:

```bash
# Set your token
TOKEN="your_jwt_token_here"

# Test sync-push (POST)
curl -X POST http://localhost:54321/functions/v1/sync-push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": 1,
    "data": {
      "users_storage": { "id": "...", "email": "..." },
      "app_settings": { "budget": 100 },
      "lists_storage": [],
      "items_storage": {},
      "runs_storage": []
    }
  }'

# Test sync-pull (GET)
curl -X GET http://localhost:54321/functions/v1/sync-pull \
  -H "Authorization: Bearer $TOKEN"
```

## GitHub Actions Automated Deployment

### 1. Configure GitHub Secrets

Add these secrets to your GitHub repository settings:

**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Required secrets:

| Secret Name | Description | How to Get |
|-------------|-------------|-----------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token for Supabase CLI | [Generate in Supabase Dashboard](https://app.supabase.com/account/tokens) |
| `SUPABASE_PROJECT_ID` | Your Supabase project ID | Visible in Supabase Dashboard URL: `app.supabase.com/project/{PROJECT_ID}/...` |
| `SUPABASE_URL` | Your Supabase project URL | `https://<project-id>.supabase.co` |

### 2. Getting Your Supabase Credentials

#### 2a. SUPABASE_ACCESS_TOKEN

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click your avatar → **Account** → **Access Tokens**
3. Click **Generate new token**
4. Name it: `GitHub Actions`
5. Copy the token and add it as `SUPABASE_ACCESS_TOKEN` secret

#### 2b. SUPABASE_PROJECT_ID

1. Go to your Supabase project
2. Click **Settings** → **General**
3. Copy the "Reference ID" (e.g., `abcdefghijklmnop`)
4. Add it as `SUPABASE_PROJECT_ID` secret

#### 2c. SUPABASE_URL

1. Go to **Settings** → **General**
2. Copy the API URL (e.g., `https://abcdefghijklmnop.supabase.co`)
3. Add it as `SUPABASE_URL` secret

### 3. Trigger Deployment

The workflow automatically deploys when you:

1. **Push to `serverless` or `main` branch** with changes to backend files:
   ```bash
   git add app.cjs services.cjs auth.cjs db.cjs validations.cjs
   git commit -m "Update backend logic"
   git push origin serverless
   ```

2. **Manually trigger** from GitHub Actions tab:
   - Go to **Actions**
   - Select **Deploy Edge Functions**
   - Click **Run workflow**

### 4. Monitor Deployment

1. Go to **Actions** tab in your GitHub repository
2. Click the latest **Deploy Edge Functions** workflow run
3. Watch logs in real-time
4. Check ✅ for success or ❌ for errors

## Deployment Flow

```
┌─────────────────────────────────────────┐
│  You push code to serverless branch     │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  GitHub Actions workflow triggers       │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  npm run build:edge                     │
│  (generates supabase/functions/...)     │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  supabase functions deploy              │
│  (uploads to Supabase project)          │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  ✅ Functions live!                     │
│  Ready to use in mobile app             │
└─────────────────────────────────────────┘
```

## Updating Your Backend

The workflow is **idempotent** — you can deploy as often as you want:

1. Make changes to your backend code:
   - `app.cjs` — Server setup
   - `services.cjs` — Route handlers
   - `auth.cjs` — Authentication logic
   - `db.cjs` — Database configuration
   - `validations.cjs` — Validation logic

2. Commit and push:
   ```bash
   git add .
   git commit -m "Update sync logic"
   git push origin serverless
   ```

3. Watch the deployment in GitHub Actions

4. The Edge Functions are automatically updated with your changes

## Troubleshooting

### Build fails locally

**Error**: `npm run build:edge` fails with file not found

**Solution**: Ensure you're in the correct directory:
```bash
cd grozeyrun-backend
npm run build:edge
```

### GitHub Actions fails with authentication error

**Error**: `Error: Invalid or missing Supabase credentials`

**Solution**: Verify your secrets are correct:
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Re-check `SUPABASE_ACCESS_TOKEN` format (should start with `sbp_`)
3. Verify `SUPABASE_PROJECT_ID` is correct (no extra spaces)

### Deployment succeeds but functions don't work

**Error**: 401 Unauthorized or token verification fails

**Solution**: Check that your mobile app sends the correct token format:
```
Authorization: Bearer <jwt_token>
```

### Generated functions have syntax errors

**Error**: Deno runtime errors in deployed functions

**Solution**: Run the build script locally and check output:
```bash
npm run build:edge
```

The generated files are in `supabase/functions/`. If there are issues, check:
- Your `services.cjs` route handlers
- Import statements in `auth.cjs` and `db.cjs`
- Environment variables (see next section)

## Environment Variables

Your Edge Functions need these environment variables set in Supabase:

1. Go to [Supabase Dashboard](https://app.supabase.com/project/{PROJECT_ID}/functions)
2. Click on a function (e.g., `sync-push`)
3. Go to **Configuration** → **Secrets**
4. Add:
   - `DATABASE_URL` — Your Postgres connection string (from **Settings** → **Database**)
   - `SUPABASE_URL` — Your project URL (from **Settings** → **API**)
   - `SUPABASE_ANON_KEY` — Public anon key (from **Settings** → **API**)

## Next Steps

1. ✅ Configure GitHub secrets (see above)
2. ✅ Set environment variables in Supabase
3. ✅ Push code to trigger first deployment
4. ✅ Monitor deployment in GitHub Actions
5. ✅ Update your mobile app to use Edge Functions URLs
6. ✅ Test sync operations end-to-end

## Questions?

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Deno Runtime Reference](https://docs.deno.com)
- GitHub Actions logs for detailed error messages
