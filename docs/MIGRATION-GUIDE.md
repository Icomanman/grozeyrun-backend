# Migrating from Express Backend to Edge Functions

This guide walks through updating your application to use Edge Functions instead of the Express backend.

## Overview

| Aspect | Express Backend | Edge Functions |
|--------|-----------------|-----------------|
| **Language** | Node.js (CommonJS) | Deno (TypeScript) |
| **Server** | Express.js | Supabase Edge Functions |
| **Database** | Direct postgres connection | Supabase JS client |
| **Endpoints** | `http://localhost:8080/api` | `https://project.supabase.co/functions/v1` |
| **Routes** | `/sync` → POST/GET | `/sync-push` (POST), `/sync-pull` (GET) |
| **Authentication** | JWT middleware | JWT verification in function |
| **Deployment** | Manual or custom CI/CD | GitHub Actions automated |

## Backend Changes

### 1. Endpoint URLs

Your Edge Functions have different URLs:

**Old Express Backend**:
```
POST http://localhost:8080/api/sync
GET  http://localhost:8080/api/sync?schema_version=1
```

**New Edge Functions**:
```
POST https://YOUR_PROJECT.supabase.co/functions/v1/sync-push
GET  https://YOUR_PROJECT.supabase.co/functions/v1/sync-pull?schema_version=1
```

### 2. Authentication

Both still use JWT bearer tokens, but Edge Functions verify them differently:

**Express Backend**:
- Your middleware verified tokens
- Same for Edge Functions, but built into each function

**No code change needed** — same header format:
```typescript
headers: {
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json'
}
```

### 3. Database Operations

Both use the Supabase client, but the underlying implementation differs:

**Express Backend**:
- Uses `postgres` client with transactions
- Raw SQL queries

**Edge Functions**:
- Use Supabase JS client with REST API
- No transaction support (each operation is atomic)

**No API change needed** — same request/response format:
```json
{
  "success": true,
  "message": "Sync successful.",
  "data": { /* sync data */ }
}
```

## Mobile App Changes

### 1. Update Endpoint Configuration

In your mobile app's service layer:

**Before (Express Backend)**:
```typescript
const BASE_URL = 'http://localhost:8080';
const API_URL = `${BASE_URL}/api`;

export const syncData = async (syncPayload: SyncPayload, jwt: string) => {
  const response = await fetch(`${API_URL}/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(syncPayload)
  });
  return response.json();
};
```

**After (Edge Functions)**:
```typescript
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';

export const syncData = async (syncPayload: SyncPayload, jwt: string) => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/sync-push`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(syncPayload)
  });
  return response.json();
};

export const fetchData = async (schemaVersion: number, jwt: string) => {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/sync-pull?schema_version=${schemaVersion}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.json();
};
```

### 2. Environment Variables

Update your mobile app's environment configuration:

**React Native / Expo example**:
```typescript
// config/environment.ts
export const ENV = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://project.supabase.co',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  // Remove old backend URL
  // backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL,
};
```

### 3. Error Handling

The response format is the same, so error handling doesn't change:

```typescript
try {
  const result = await syncData(payload, jwt);
  
  if (!result.success) {
    console.error('Sync failed:', result.message);
    throw new Error(result.message);
  }
  
  return result.data;
} catch (error) {
  console.error('Sync error:', error);
  // Your error handling logic
}
```

### 4. CORS Headers

Edge Functions now handle CORS requests. You may need to:

- Update any CORS interceptors to handle `https://project.supabase.co` origin
- Remove localhost/Express-specific CORS handling
- Keep the same JWT/auth headers

## Testing the Migration

### 1. Test Locally First

```bash
# Build Edge Functions
npm run build:edge

# Start local Supabase
supabase start

# Deploy locally
supabase functions deploy sync-push --no-verify
supabase functions deploy sync-pull --no-verify

# Update your mobile app's BASE_URL to point to local Supabase
// config/environment.ts
export const ENV = {
  supabaseUrl: 'http://localhost:54321',
  // ...
};

# Run mobile app tests
npm test
```

### 2. Test in Staging

Once deployed to your Supabase staging project:

```typescript
// config/environment.ts (staging)
export const ENV = {
  supabaseUrl: 'https://staging-project.supabase.co',
  // ...
};
```

### 3. Test in Production

Deploy to your production Supabase project and update the mobile app to use the production URL.

## Rollback Plan

If Edge Functions aren't working:

### Option 1: Keep Express Backend Running

Run both backends simultaneously during migration:

```typescript
// config/environment.ts
export const ENV = {
  syncEndpoint: process.env.USE_EDGE_FUNCTIONS === 'true'
    ? 'https://project.supabase.co/functions/v1/sync-push'
    : 'http://backend.example.com/api/sync',
};
```

### Option 2: Revert Git Commits

Since Edge Functions are generated from the build script:

```bash
# Just stop pushing to main branch
# The GitHub Actions workflow won't trigger
# Your backend continues running
```

### Option 3: Keep Express Backend Endpoint Active

The Express backend can continue running on a separate port while Edge Functions handle new traffic:

```bash
# Backend continues on port 8080
npm start

# Edge Functions available at supabase.co/functions/v1
# Update mobile app to use new endpoint
```

## Performance Considerations

### Edge Functions vs Express

| Factor | Edge Functions | Express Backend |
|--------|---|---|
| Cold start | ~100-500ms | Warm (always running) |
| Geographic latency | Low (Supabase edge network) | Depends on hosting |
| Scaling | Automatic | Manual |
| Cost | Pay per invocation | Fixed infrastructure |
| Timeout | 10 minutes | Configurable |
| Memory | 256MB | Configurable |

### Optimization Tips

1. **Reduce payload size**: Paginate large sync operations
2. **Batch operations**: Send multiple items in one request
3. **Cache results**: Use mobile app's AsyncStorage for offline
4. **Monitor cold starts**: Check Supabase function logs

## Monitoring & Debugging

### View Edge Function Logs

**Supabase Console**:
1. Navigate to **Functions**
2. Click `sync-push` or `sync-pull`
3. View **Logs** tab for real-time execution logs

```bash
# Or via Supabase CLI
supabase functions logs sync-push --project-id YOUR_PROJECT_ID
```

### Common Issues & Solutions

**Issue**: Requests timeout
- **Cause**: Large sync payloads or slow database queries
- **Solution**: Implement pagination, optimize queries

**Issue**: 401 Authorization Failed
- **Cause**: Invalid or expired JWT token
- **Solution**: Verify token with `supabase.auth.getUser(token)`

**Issue**: 500 Internal Server Error
- **Cause**: Database operation failed
- **Solution**: Check logs for specific error, verify schema

**Issue**: CORS errors
- **Cause**: Request origin not allowed
- **Solution**: Edge Functions handle CORS; check headers

## Checklist for Migration

- [ ] Build Edge Functions locally: `npm run build:edge`
- [ ] Test endpoints locally with Supabase CLI
- [ ] Update mobile app endpoint URLs
- [ ] Update environment variables (BASE_URL → SUPABASE_URL)
- [ ] Update authentication headers (should be same)
- [ ] Update error handling if needed
- [ ] Test sync flows on staging
- [ ] Deploy to production
- [ ] Monitor Edge Function logs
- [ ] Verify mobile app users can sync
- [ ] Optionally decommission Express backend

## Keeping Both Backends Active (During Migration)

If you want a gradual migration:

```typescript
// Mobile app service layer
export class SyncService {
  constructor(private useEdgeFunctions: boolean = false) {}
  
  async sync(payload: SyncPayload, jwt: string) {
    const endpoint = this.useEdgeFunctions
      ? 'https://project.supabase.co/functions/v1/sync-push'
      : 'http://backend.example.com/api/sync';
    
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify(payload)
    });
  }
}

// Toggle via feature flag or config
const syncService = new SyncService(USE_EDGE_FUNCTIONS);
```

This lets you:
1. Deploy Edge Functions first
2. Test with a subset of users (A/B testing)
3. Monitor performance
4. Gradually shift traffic
5. Finally deprecate Express backend

---

**Need help?** Check:
- [Edge Functions Build Guide](edge-functions-build.md)
- [GitHub Actions Setup](github-actions-setup.md)
- [Supabase Functions Documentation](https://supabase.com/docs/guides/functions)
