# Edge Functions Build System Architecture

This document explains how your Express backend is transformed into Supabase Edge Functions.

## Problem Statement

**Express Backend** (your current setup):
- Node.js runtime
- CommonJS modules
- HTTP server with routing
- Express middleware
- Connection pooling

**Supabase Edge Functions** (deployment target):
- Deno runtime (TypeScript-native)
- ES modules only
- Distributed serverless compute
- No persistent connections
- No traditional Express framework

## Solution: Automated Transformation

The build script (`scripts/build-edge-functions.js`) solves this by:

1. **Extracting route handlers** from `services.cjs`
2. **Converting CommonJS** to TypeScript (Deno-compatible)
3. **Replacing Express** with Deno native HTTP handling
4. **Translating middleware** to function-level logic
5. **Adapting database access** for serverless environment

## Build Process Walkthrough

### Stage 1: Code Analysis

```javascript
// Input: Your Express backend files
app.cjs              // Server setup, middleware
services.cjs         // Route handlers (POST /api/sync, GET /api/sync)
auth.cjs             // JWT verification, Supabase Auth client
db.cjs               // Postgres connection
validations.cjs      // Business logic validation
```

### Stage 2: Route Extraction

The script identifies your routes and creates a function for each:

**Express (current)**:
```javascript
// services.cjs
const syncPush = async (req, res) => { /* ... */ };
const syncPull = async (req, res) => { /* ... */ };

app.post('/api/sync', authMiddleware, syncPush);
app.get('/api/sync', authMiddleware, syncPull);
```

**Edge Functions (generated)**:
```typescript
// supabase/functions/sync-push/index.ts
Deno.serve(async (req) => {
  // Auth verification
  // Payload validation
  // Database operations
  // Response handling
});

// supabase/functions/sync-pull/index.ts
Deno.serve(async (req) => { /* ... */ });
```

### Stage 3: Dependency Conversion

**Imports**:
- CommonJS `require()` → ES module `import` (Deno-compatible)
- Node.js `postgres` package → `deno.land/x/postgres` Deno module
- Supabase client → ESM version from `esm.sh`

**Environment**:
- `process.env.*` → `Deno.env.get("*")`
- `process.cwd()` → `Deno.cwd()` (limited in Edge Functions)

### Stage 4: Middleware Translation

**Express Middleware** (runs before handler):
```javascript
app.use(express.json());
app.use(authMiddleware);
app.post('/api/sync', syncPush);
```

**Edge Function** (inline logic):
```typescript
Deno.serve(async (req) => {
  // Parse JSON
  const body = await req.json();
  
  // Verify auth token inline
  const token = req.headers.get("Authorization")?.slice(7);
  const { data: { user } } = await supabase.auth.getUser(token);
  
  // Business logic
  // ...
});
```

### Stage 5: Database Adaptation

**Express** (persistent connection pool):
```javascript
const sql = postgres(process.env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20
});

// Reuse same connection pool across requests
await sql`SELECT * FROM users WHERE id = ${id}`;
```

**Edge Function** (ephemeral connection):
```typescript
const pool = new postgres.Pool(Deno.env.get("DATABASE_URL"), {
  max: 5,
});
const connection = await pool.connect();

try {
  // Use connection
  await connection.queryArray("SELECT * FROM users WHERE id = $1", [id]);
} finally {
  connection.release();
}
```

Reason: Each Edge Function invocation is independent; persistent pools would cause resource leaks.

### Stage 6: Response Handling

**Express**:
```javascript
res.json({ success: true, data: payload });
res.status(401).json({ error: "Unauthorized" });
```

**Edge Function** (Web API Response):
```typescript
new Response(JSON.stringify({ success: true, data: payload }), {
  status: 200,
  headers: { "Content-Type": "application/json", ...corsHeaders }
});

new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401,
  headers: { "Content-Type": "application/json", ...corsHeaders }
});
```

## Code Mapping Reference

### Your Backend Files → Generated Functions

| Source File | What It Provides | Used In |
|-------------|-----------------|---------|
| `auth.cjs` | JWT verification logic | `supabase/functions/*/index.ts` (inline) |
| `db.cjs` | Connection config, Postgres setup | `supabase/functions/*/index.ts` (adapted) |
| `services.cjs` | Route handlers, business logic | `supabase/functions/sync-{push,pull}/index.ts` |
| `validations.cjs` | Validation functions | `supabase/functions/sync-push/index.ts` (inline) |

### Preserved Logic

These are NOT rewritten; they're extracted and adapted:
- ✅ JWT token verification from `auth.cjs`
- ✅ Validation functions from `validations.cjs`
- ✅ Database transaction logic from `services.cjs`
- ✅ SQL queries (converted to Deno postgres format)
- ✅ Error handling patterns
- ✅ Response structures

### Differences You Need to Know

| Aspect | Express Backend | Edge Functions |
|--------|-----------------|----------------|
| Runtime | Node.js | Deno |
| Language | CommonJS JavaScript | TypeScript (can use .js too) |
| Routing | Express Router | Individual functions |
| Middleware | `app.use(middleware)` | Inline in each function |
| HTTP Server | Listen on port | Handled by Supabase |
| Deployment | VPS/Cloud VM | Serverless (global edge locations) |
| Cold starts | N/A | ~100ms first request |
| Connections | Persistent pool | Per-invocation |
| Environment | Configured locally | Secrets via Supabase dashboard |
| Scaling | Vertical (bigger instances) | Horizontal (auto, per region) |

## Generated Function Structure

### Example: sync-push

```typescript
// Header: Imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { postgres } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

// CORS headers (Edge Functions run across origins)
const corsHeaders = { /* ... */ };

// Validation functions (extracted from validations.cjs)
function validateSyncPayload(data) { /* ... */ }
function validateOwnership(data, owner_id) { /* ... */ }

// Main handler (Deno.serve API)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Auth: Extract and verify JWT token
    // 2. Parse: Get request body and validate
    // 3. Access: Connect to database
    // 4. Execute: Transaction (same logic as Express route)
    // 5. Return: JSON response with headers
  } catch (error) {
    // Error handling
  }
});
```

## How to Debug

### Check Generated Files

After running `npm run build:edge`, inspect:

```bash
cat supabase/functions/sync-push/index.ts
cat supabase/functions/sync-pull/index.ts
```

Look for:
- ✅ Correct Deno imports
- ✅ Validation functions present
- ✅ Your business logic intact
- ✅ CORS headers configured
- ✅ Environment variable usage via `Deno.env.get()`

### Common Issues

**Issue**: Generated functions have `require()` statements
- **Cause**: Build script failed to convert imports
- **Fix**: Check syntax of `auth.cjs`, `db.cjs`, `validations.cjs`

**Issue**: Generated functions are missing validation logic
- **Cause**: `validations.cjs` not parsed correctly
- **Fix**: Ensure file follows expected structure

**Issue**: Database queries fail at runtime
- **Cause**: SQL syntax or parameter binding mismatch
- **Fix**: Verify query uses `$1, $2...` placeholders (not CommonJS template literals)

### Local Testing

Before GitHub Actions deployment, validate locally:

```bash
# Build
npm run build:edge

# Inspect generated file
cat supabase/functions/sync-push/index.ts

# Check syntax
deno check supabase/functions/sync-push/index.ts

# Run locally (requires Supabase CLI)
supabase functions serve
```

## Extending the Build System

To add new routes:

1. **Add route handler** in `services.cjs`:
   ```javascript
   const newRoute = async (req, res) => { /* ... */ };
   ```

2. **Add to exports**:
   ```javascript
   module.exports = () => {
     const router = express.Router();
     router.post('/sync', authMiddleware, syncPush);
     router.post('/new-route', authMiddleware, newRoute);
     return router;
   };
   ```

3. **Update build script** to generate new function:
   ```javascript
   function generateNewRouteFunction() {
     return `...TypeScript code...`;
   }
   
   // In build():
   fs.writeFileSync(
     path.join(SUPABASE_FUNCTIONS_DIR, 'new-route', 'index.ts'),
     generateNewRouteFunction()
   );
   ```

4. **Redeploy**:
   ```bash
   npm run build:edge
   supabase functions deploy new-route
   ```

## Performance Characteristics

### Edge Functions vs Express Backend

| Metric | Edge Functions | Express Backend |
|--------|---|---|
| Cold start latency | ~100ms | N/A (always warm) |
| Warm request latency | ~50-200ms | ~10-50ms |
| Scalability | Auto (infinite) | Limited to instance size |
| Cost | Pay per invocation | Pay per instance hour |
| Availability | 99.99% SLA | Depends on infrastructure |
| Geographic distribution | Global (edge locations) | Single region |

Edge Functions are optimal for **sporadic, global traffic**. For **high-frequency, latency-critical** operations, keep some work on your Express backend.

## Next Steps

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [Deno Manual](https://docs.deno.com)
- [Review generated code](supabase/functions/) after building
