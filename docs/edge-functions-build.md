# Edge Functions Build & Deployment Guide

This document explains how the backend Express app is converted to Supabase Edge Functions and automatically deployed.

## Overview

The backend is designed as a **thin Node.js Express layer** but needs to run on **Supabase Edge Functions** (which use Deno). This build system handles the conversion automatically.

### Architecture

```
┌─────────────────────────────────┐
│   grozeyrun-backend (Node.js)   │
│   - app.cjs                     │
│   - auth.cjs                    │
│   - services.cjs                │
│   - db.cjs                      │
│   - validations.cjs             │
└─────────────────┬───────────────┘
                  │ npm run build:edge
                  ▼
┌─────────────────────────────────┐
│   supabase/functions/           │
│   ├── sync-push/index.ts        │
│   ├── sync-pull/index.ts        │
│   └── deno.json                 │
└─────────────────┬───────────────┘
                  │ GitHub Actions
                  ▼
┌─────────────────────────────────┐
│   Supabase Edge Functions       │
│   - POST /api/sync (sync-push)  │
│   - GET /api/sync (sync-pull)   │
└─────────────────────────────────┘
```

## Build Process

The build script (`scripts/build-edge-functions.js`) performs the following:

1. **Reads your Express backend code** (CommonJS)
2. **Generates Deno-compatible TypeScript** Edge Functions
   - Converts CommonJS to ES modules
   - Replaces Express request/response handling with Deno HTTP
   - Uses Supabase JS client for database operations
   - Preserves all validation and business logic
3. **Outputs to `supabase/functions/`** directory

### What Gets Generated

- `supabase/functions/sync-push/index.ts` — POST /api/sync endpoint (full-state push)
- `supabase/functions/sync-pull/index.ts` — GET /api/sync endpoint (full-state pull)
- `supabase/functions/deno.json` — Deno configuration with import maps

## Local Usage

### Build Edge Functions

```bash
npm run build:edge
```

This generates the Edge Functions in `supabase/functions/`. The output is **not committed** (add `supabase/functions/` to `.gitignore` if needed).

### Test Locally

```bash
# Install Supabase CLI (one-time)
brew install supabase/tap/supabase
# or: npm install -g supabase

# Start local Supabase
supabase start

# Deploy functions locally
supabase functions deploy sync-push --no-verify
supabase functions deploy sync-pull --no-verify

# Test the functions
curl -X POST http://localhost:54321/functions/v1/sync-push \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schema_version": 1, "data": {...}}'
```

### Deploy to Production Supabase

```bash
supabase functions deploy sync-push --project-id YOUR_PROJECT_ID
supabase functions deploy sync-pull --project-id YOUR_PROJECT_ID
```

## Automated Deployment via GitHub Actions

The workflow file (`.github/workflows/deploy-edge-functions.yml`) automates the entire process:

### Trigger Events

The workflow runs automatically when:

- You push to `main` or `develop` branches
- Changes include backend files:
  - `app.cjs`, `auth.cjs`, `db.cjs`, `services.cjs`, `validations.cjs`
  - `package.json`
  - `scripts/build-edge-functions.js`
  - The workflow file itself

You can also manually trigger it via the **Actions** tab on GitHub.

### Deployment Steps

1. **Checkout** your code
2. **Set up Node.js** (v20)
3. **Install dependencies** from `package.json`
4. **Build Edge Functions** using `npm run build:edge`
5. **Set up Supabase CLI**
6. **Deploy** `sync-push` and `sync-pull` to your Supabase project
7. **Verify** deployment by listing functions

### Required GitHub Secrets

You need to configure these secrets in your GitHub repository settings:

| Secret | Description | Where to Get |
|--------|-------------|--------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token for Supabase CLI | Supabase Account → Settings → Access Tokens |
| `SUPABASE_PROJECT_ID` | Your Supabase project ID | Supabase Console → Project Settings → General |
| `SUPABASE_URL` | Your Supabase API URL | Supabase Console → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (never expose publicly!) | Supabase Console → Project Settings → API → Service role key |
| `SUPABASE_DB_PASSWORD` | Database password (optional, for migrations) | Supabase Console → Database → Connection String |

#### Setting Up GitHub Secrets

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret from the table above

⚠️ **Security Warning**: Never commit these secrets to your repository. The workflow accesses them safely via GitHub's encrypted secret storage.

## File Changes Workflow

When you make changes to the backend:

1. **Edit backend files** (app.cjs, services.cjs, etc.)
2. **Commit and push** to `main` or `develop`
3. **GitHub Actions automatically**:
   - Runs the build script
   - Generates new Edge Functions
   - Deploys them to Supabase
4. **Your Edge Functions are live** 🚀

No manual build or deployment steps required!

## Troubleshooting

### Workflow Fails: "Invalid credentials"

- Verify all secrets are correctly set in GitHub Settings
- Ensure `SUPABASE_ACCESS_TOKEN` hasn't expired
- Regenerate tokens if needed

### Workflow Fails: "Function deployment failed"

- Check the workflow logs in GitHub Actions for error details
- Ensure your Supabase project has sufficient quota
- Verify database schema matches what functions expect

### Functions Work Locally But Not in Production

- Verify all environment variables are set in Supabase
- Check function logs in Supabase Console: **Functions** → Select function → **Logs**
- Ensure database migrations have been applied

### Build Script Errors

```bash
# Run locally to debug
npm run build:edge

# Check the generated files
ls -la supabase/functions/
```

## Modifying Edge Functions

To update the generated Edge Functions:

1. **Modify the build script** (`scripts/build-edge-functions.js`)
2. **Edit the template strings** `generateSyncPushFunction()` or `generateSyncPullFunction()`
3. **Rebuild locally**: `npm run build:edge`
4. **Test locally** with Supabase CLI (see "Test Locally" section above)
5. **Commit and push** — GitHub Actions will deploy automatically

## Database Operations

The Edge Functions use the Supabase JavaScript client to interact with your database. Key differences from the Express backend:

| Operation | Express Backend | Edge Functions |
|-----------|-----------------|-----------------|
| Database Client | `postgres` module | Supabase JS client |
| Transactions | `sql.begin()` | Individual `.insert()` / `.upsert()` calls |
| Error Handling | Try/catch with rollback | Try/catch per operation |
| Auth | Supabase JWT verification | Supabase JWT verification |

⚠️ **Note**: Edge Functions don't support database transactions the same way. The build script uses individual upsert/insert operations. For critical transaction guarantees, consider:

- Using Supabase stored procedures for multi-step operations
- Implementing retry logic in the mobile app
- Adding idempotency keys to prevent duplicate data

## Environment Variables in Edge Functions

Edge Functions can access environment variables via `Deno.env.get()`:

```typescript
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
```

Set these in Supabase Console: **Functions** → Select function → **Settings** → **Secrets**.

The GitHub Actions workflow automatically passes these during deployment.

## Monitoring & Logs

After deployment, monitor your Edge Functions:

1. **Supabase Console** → **Functions**
2. Select `sync-push` or `sync-pull`
3. View **Logs** tab for real-time execution logs
4. Check **Deployments** tab for version history

## Performance Considerations

- **Timeout**: Edge Functions have a 10-minute timeout by default
- **Memory**: Each function gets 256MB by default
- **Cold starts**: First request after deployment may be slower
- **Concurrent requests**: Supabase handles auto-scaling

For heavy workloads (e.g., syncing thousands of items), consider:
- Implementing pagination in the mobile app
- Splitting large sync operations into multiple requests
- Optimizing database queries with indexes

## Next Steps

1. ✅ Commit the build script and workflow files
2. ✅ Set up GitHub secrets
3. ✅ Push to `main` or `develop` to trigger first deployment
4. ✅ Monitor the GitHub Actions workflow
5. ✅ Verify Edge Functions in Supabase Console
6. ✅ Update mobile app to use Edge Functions endpoint

---

For more information:
- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Deno Manual](https://deno.land/manual)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
