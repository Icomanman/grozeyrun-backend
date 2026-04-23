# Quick Start: Edge Functions Deployment

Get your Edge Functions deployed in 5 minutes.

## 1️⃣ Set Up GitHub Secrets (2 minutes)

See [GitHub Actions Setup Guide](github-actions-setup.md) for detailed steps. You need:

- `SUPABASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ACCESS_TOKEN`

## 2️⃣ Build Locally (30 seconds)

```bash
npm run build:edge
```

This creates `supabase/functions/` with your Edge Functions.

## 3️⃣ Commit and Push (1 minute)

```bash
git add .
git commit -m "Add Edge Functions build and deployment"
git push origin main
```

## 4️⃣ Watch GitHub Actions Deploy (1.5 minutes)

1. Go to your repo's **Actions** tab
2. Click the running workflow
3. Watch the deployment complete ✅

## 5️⃣ Verify in Supabase

Go to **Supabase Console** → **Functions** and you should see:
- `sync-push` — POST endpoint
- `sync-pull` — GET endpoint

Both deployed and ready! 🚀

## Test the Functions

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/sync-push \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schema_version": 1, "data": {...}}'
```

## Update Mobile App

Update your mobile app to call the Edge Functions:

```javascript
const response = await fetch(
  `https://YOUR_PROJECT.supabase.co/functions/v1/sync-push`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schema_version: 1,
      data: { /* sync payload */ }
    })
  }
);
```

---

**That's it!** Your backend is now deployed as Edge Functions with automated CI/CD. 🎉

For detailed information, see [Edge Functions Build & Deployment Guide](edge-functions-build.md).
