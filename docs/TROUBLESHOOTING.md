# Troubleshooting & Quick Reference

## Quick Commands

```bash
# Build locally
npm run build:edge

# View generated functions
ls -la supabase/functions/

# Test locally
supabase functions serve

# Check generated code
cat supabase/functions/sync-push/index.ts

# Check syntax (requires Deno)
deno check supabase/functions/sync-push/index.ts

# Manually deploy
supabase functions deploy sync-push --project-ref <PROJECT_ID>
supabase functions deploy sync-pull --project-ref <PROJECT_ID>

# List deployed functions
supabase functions list --project-ref <PROJECT_ID>

# View function logs
supabase functions get-logs sync-push --project-ref <PROJECT_ID>
```

## Common Issues & Solutions

### ❌ Build Fails: "Module not found"

**Error**:
```
Error: Cannot find module './db.cjs'
```

**Solutions**:
1. Check file exists: `ls -la db.cjs auth.cjs services.cjs validations.cjs`
2. Run from correct directory: `cd grozeyrun-backend && npm run build:edge`
3. Check file permissions: `chmod +r db.cjs auth.cjs services.cjs validations.cjs`

---

### ❌ Build Succeeds but Generated Functions Have Errors

**Symptoms**:
- `npm run build:edge` completes with ✅
- But `supabase functions serve` fails with Deno errors
- Or logs show TypeScript errors

**Check**:
```bash
cat supabase/functions/sync-push/index.ts | head -50
```

**Look for**:
- ❌ `require()` calls (should be `import`)
- ❌ `process.env` (should be `Deno.env.get()`)
- ❌ Node.js modules like `express`, `postgres` (should be Deno equivalents)

**Solution**: Check syntax of source files:
- `auth.cjs` — Should only export middleware function
- `db.cjs` — Should only export postgres config
- `services.cjs` — Should export Express router with handlers

---

### ❌ GitHub Actions Fails: "Invalid credentials"

**Error Log**:
```
Error: Invalid Supabase credentials
supabase: command not found
```

**Causes & Fixes**:

1. **Missing secrets**:
   - Go to GitHub Repo → Settings → Secrets
   - Verify you have:
     - `SUPABASE_ACCESS_TOKEN`
     - `SUPABASE_PROJECT_ID`
     - `SUPABASE_URL`

2. **Wrong token format**:
   - `SUPABASE_ACCESS_TOKEN` should start with `sbp_`
   - Get new token: https://app.supabase.com/account/tokens

3. **Wrong project ID**:
   - Go to Supabase Dashboard → Settings → General
   - Copy "Reference ID" (e.g., `abcdefghijklmnop`)
   - NOT the project name

4. **Whitespace in secrets**:
   - Paste exactly, no extra spaces before/after
   - Use `|` (pipe) in YAML if multiline needed

---

### ❌ Deployment Succeeds But Functions Return 401 Unauthorized

**Problem**: Mobile app gets 401 when calling Edge Function

**Causes**:

1. **Missing `DATABASE_URL` environment variable**:
   - Go to Supabase Project → Functions
   - Click function → Configuration → Secrets
   - Add `DATABASE_URL` from Settings → Database
   - Format: `postgres://user:password@host:port/db`

2. **Missing `SUPABASE_ANON_KEY`**:
   - Go to Settings → API
   - Copy "anon" public key
   - Add as secret in function configuration

3. **Token doesn't have user data**:
   - Mobile app should send: `Authorization: Bearer <token>`
   - Token must be valid Supabase JWT
   - Verify: `supabase functions get-logs sync-push --tail`

4. **CORS headers missing**:
   - Check generated function has `corsHeaders` defined
   - All responses should include: `...corsHeaders`

**Fix**: Check logs
```bash
supabase functions get-logs sync-push --project-ref <PROJECT_ID> --tail
supabase functions get-logs sync-pull --project-ref <PROJECT_ID> --tail
```

---

### ❌ Database Operations Fail: "table does not exist"

**Error Log**:
```
Error: relation "public.users" does not exist
```

**Causes**:

1. **Wrong database URL**:
   - Check `DATABASE_URL` secret in function configuration
   - Should point to YOUR Supabase database
   - NOT a different project

2. **Schema not created**:
   - Verify tables exist in Supabase:
     - Go to Project → SQL Editor
     - Run: `SELECT * FROM information_schema.tables WHERE table_schema = 'public';`
   - If missing, run your schema file:
     - Copy schema.sql content
     - Paste in SQL Editor → Run

3. **Connection string uses wrong port**:
   - Use port `5432` for direct connection
   - Use port `6543` for connection pooler (but set `prepare: false`)
   - Supabase connection string typically uses pooler

---

### ❌ Functions Work Locally But Fail in GitHub Actions

**Problem**: `supabase functions serve` works, but deployment fails

**Check**:

1. **Build output is the same**:
   ```bash
   # Locally
   npm run build:edge
   cat supabase/functions/sync-push/index.ts

   # Compare with GitHub Actions log (check Actions tab)
   ```

2. **Secrets are configured**:
   ```bash
   # This WON'T work locally (no secrets):
   SUPABASE_ACCESS_TOKEN=xyz supabase functions deploy sync-push
   
   # Secrets are only available in GitHub Actions
   # Check GitHub Secrets are correct (case-sensitive!)
   ```

3. **Branch is correct**:
   - Workflow triggers on: `serverless` or `main` branch
   - Check which branch you're pushing to
   - Make sure file changes match `paths:` filter

---

### ❌ Functions Deployed But Not Calling Correctly

**Problem**: Function exists in Supabase Console but mobile app can't reach it

**Check**:

1. **Correct URL format**:
   ```
   ❌ https://sync-push.supabase.co  (wrong)
   ✅ https://<project-id>.supabase.co/functions/v1/sync-push  (correct)
   ```

2. **Method is correct**:
   ```
   sync-push: POST /functions/v1/sync-push
   sync-pull: GET /functions/v1/sync-pull
   ```

3. **Headers include auth**:
   ```
   Authorization: Bearer <jwt_token>
   Content-Type: application/json
   ```

4. **Function is deployed**:
   ```bash
   supabase functions list --project-ref <PROJECT_ID>
   
   # Should show:
   # sync-push  (default)   pending
   # sync-pull  (default)   pending
   ```
   Wait a minute for `pending` → `active` state

---

### ❌ Changes Pushed But Deployment Didn't Trigger

**Problem**: Pushed code but GitHub Actions workflow didn't run

**Check**:

1. **Branch is correct**:
   ```bash
   git branch
   git push origin serverless  # or main (both work)
   ```

2. **Modified correct files** (only these trigger workflow):
   - `app.cjs`, `auth.cjs`, `db.cjs`, `services.cjs`, `validations.cjs`
   - `package.json` or `scripts/build-edge-functions.js`
   - `.github/workflows/deploy-edge-functions.yml`

3. **Check Actions tab**:
   - Go to GitHub Repo → Actions
   - Filter by workflow: "Deploy Edge Functions"
   - If nothing shows, you might have changed unrelated files

4. **Manually trigger workflow**:
   - Go to Actions → Deploy Edge Functions
   - Click "Run workflow"
   - Select branch: `serverless`
   - Click "Run workflow"

---

## Performance Tips

### Optimize Build Time

```bash
# Skip npm install if dependencies haven't changed
npm run build:edge
# (only runs the actual build)

# Instead of:
npm ci
npm run build:edge
```

### Optimize Function Cold Starts

- Keep function size small (generated functions are ~20KB)
- Avoid large dependencies
- Connect to database only when needed (connection pooling overhead)

### Monitor Function Usage

```bash
# Check invocation count and errors
supabase functions get-logs sync-push --project-ref <PROJECT_ID>

# Get stats (if available in dashboard)
# Project → Functions → Click function → Analytics
```

---

## Deployment Checklist

Before considering deployment complete:

- [ ] Build script runs locally: `npm run build:edge`
- [ ] Generated files in `supabase/functions/`:
  - [ ] `sync-push/index.ts` exists
  - [ ] `sync-pull/index.ts` exists
- [ ] GitHub Secrets configured (3 required):
  - [ ] `SUPABASE_ACCESS_TOKEN`
  - [ ] `SUPABASE_PROJECT_ID`
  - [ ] `SUPABASE_URL`
- [ ] Function environment variables set:
  - [ ] `DATABASE_URL`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_URL`
- [ ] GitHub Actions workflow succeeded:
  - [ ] Actions tab shows ✅ for latest run
  - [ ] No errors in logs
- [ ] Functions deployed to Supabase:
  - [ ] `supabase functions list` shows both functions as `active`
- [ ] Functions tested:
  - [ ] Local: `supabase functions serve` works
  - [ ] Remote: Can call from mobile app without 401 errors
- [ ] Database operations work:
  - [ ] Check logs: `supabase functions get-logs sync-push --tail`
  - [ ] Mobile app receives data from GET /sync

---

## Getting Help

1. **Check GitHub Actions logs**: Actions tab → Latest run → Logs
2. **Check Supabase function logs**:
   ```bash
   supabase functions get-logs sync-push --project-ref <PROJECT_ID> --tail
   ```
3. **Inspect generated code**:
   ```bash
   cat supabase/functions/sync-push/index.ts
   ```
4. **Review build script**:
   ```bash
   cat scripts/build-edge-functions.js
   ```
5. **Test with curl**:
   ```bash
   curl -X POST https://<project-id>.supabase.co/functions/v1/sync-push \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"schema_version": 1, "data": {...}}'
   ```

---

## Still Stuck?

1. Check the [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
2. Check the [Deno Manual](https://docs.deno.com)
3. Review [EDGE-FUNCTIONS-ARCHITECTURE.md](EDGE-FUNCTIONS-ARCHITECTURE.md) for detailed explanation
4. Check [SETUP-BUILD-SYSTEM.md](SETUP-BUILD-SYSTEM.md) for full setup guide
