#!/usr/bin/env node
'use strict';

/**
 * Build script: Convert Express backend to Supabase Edge Functions
 *
 * This script transforms the Node.js Express backend into Deno-compatible
 * TypeScript Edge Functions. Each route becomes a standalone function file.
 *
 * Run: npm run build:edge
 * Output: supabase/functions/
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_FUNCTIONS_DIR = path.join(__dirname, '..', 'supabase', 'functions');

/**
 * Ensure output directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
}

/**
 * Generate the sync-push Edge Function
 */
function generateSyncPushFunction() {
  return `import { postgres } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
};

// ─────────────────────────────────────────────────────────────────────
// Helper: Decode JWT without verification (Edge Functions pattern)
// ─────────────────────────────────────────────────────────────────────

function decodeJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token format");
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Validation functions (from validations.cjs)
// ─────────────────────────────────────────────────────────────────────

const REQUIRED_DATA_KEYS = ["items_storage", "lists_storage", "runs_storage", "users_storage", "app_settings"];
const OPTIONAL_ARRAY_KEYS = ["list_shares_storage"];
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

function validateSyncPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Missing or invalid data payload.";
  }
  for (const key of REQUIRED_DATA_KEYS) {
    if (!(key in data)) {
      return \`Missing required field: data.\${key}.\`;
    }
  }
  if (typeof data.items_storage !== "object" || Array.isArray(data.items_storage)) {
    return "data.items_storage must be a plain object (Record<listId, ListItem[]>).";
  }
  if (!Array.isArray(data.lists_storage)) {
    return "data.lists_storage must be an array.";
  }
  if (!Array.isArray(data.runs_storage)) {
    return "data.runs_storage must be an array.";
  }
  if (typeof data.users_storage !== "object" || Array.isArray(data.users_storage)) {
    return "data.users_storage must be a plain object.";
  }
  if (typeof data.app_settings !== "object" || Array.isArray(data.app_settings)) {
    return "data.app_settings must be a plain object.";
  }
  for (const key of OPTIONAL_ARRAY_KEYS) {
    if (key in data && !Array.isArray(data[key])) {
      return \`data.\${key} must be an array when present.\`;
    }
  }
  return null;
}

function validateOwnership(data, owner_id) {
  const { users_storage, lists_storage } = data;
  if (users_storage && users_storage.id && users_storage.id !== owner_id) {
    return "User ID mismatch.";
  }
  if (Array.isArray(lists_storage)) {
    for (const list of lists_storage) {
      if (list.owner_id && list.owner_id !== owner_id) {
        return "List ownership mismatch.";
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Edge Function: POST /api/sync (full-state push)
// ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Extract auth token from Authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing or invalid Authorization header." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // 2. Decode JWT (DO NOT call supabase.auth.getUser - it times out)
    const payload = decodeJWT(token);
    if (!payload || !payload.sub) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid token." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const owner_id = payload.sub;
    // 3. Parse request body
    const body = await req.json();
    const { schema_version, data } = body;

    if (!SUPPORTED_SCHEMA_VERSIONS.has(Number(schema_version))) {
      return new Response(
        JSON.stringify({ success: false, message: \`Unsupported schema_version: \${schema_version}.\` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const payloadError = validateSyncPayload(data);
    if (payloadError) {
      return new Response(
        JSON.stringify({ success: false, message: payloadError }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const ownerError = validateOwnership(data, owner_id);
    if (ownerError) {
      return new Response(
        JSON.stringify({ success: false, message: ownerError }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { items_storage, lists_storage, runs_storage, users_storage, app_settings, list_shares_storage } = data;
    const flatItems = Object.values(items_storage ?? {}).flat();

    // Connect to Postgres via Supabase
    const pool = new postgres.Pool(Deno.env.get("DATABASE_URL") || "", {
      max: 5,
    });

    const connection = await pool.connect();

    try {
      await connection.queryArray("BEGIN");

      // ── 1. Upsert user profile ──────────────────────────────────────────
      if (users_storage) {
        await connection.queryArray(
          \`INSERT INTO public.users (id, email, first_name, last_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
               email      = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               last_name  = EXCLUDED.last_name,
               updated_at = EXCLUDED.updated_at\`,
          [
            owner_id,
            users_storage.email ?? null,
            users_storage.first_name ?? null,
            users_storage.last_name ?? null,
            users_storage.created_at ?? new Date().toISOString(),
            users_storage.updated_at ?? new Date().toISOString(),
          ]
        );
      }

      // ── 2. Upsert app settings ──────────────────────────────────────────
      if (app_settings) {
        await connection.queryArray(
          \`INSERT INTO public.app_settings (user_id, budget, currency, max_hours, notifications, period, theme, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id) DO UPDATE SET
               budget        = EXCLUDED.budget,
               currency      = EXCLUDED.currency,
               max_hours     = EXCLUDED.max_hours,
               notifications = EXCLUDED.notifications,
               period        = EXCLUDED.period,
               theme         = EXCLUDED.theme,
               updated_at    = EXCLUDED.updated_at\`,
          [
            owner_id,
            app_settings.budget ?? null,
            app_settings.currency ?? null,
            app_settings.max_hours ?? null,
            app_settings.notifications ?? true,
            app_settings.period ?? "monthly",
            app_settings.theme ?? "light",
            app_settings.updated_at ?? new Date().toISOString(),
          ]
        );
      }

      // ── 3. Delete existing lists (cascades to items, runs, list_shares) ──
      await connection.queryArray("DELETE FROM public.lists WHERE owner_id = $1", [owner_id]);

      // ── 4. Insert lists ─────────────────────────────────────────────────
      if (Array.isArray(lists_storage)) {
        for (const list of lists_storage) {
          await connection.queryArray(
            \`INSERT INTO public.lists (id, owner_id, name, color, emoji, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\`,
            [
              list.id,
              owner_id,
              list.name,
              list.color ?? null,
              list.emoji ?? null,
              list.created_at ?? new Date().toISOString(),
              list.updated_at ?? new Date().toISOString(),
              list.deleted_at ?? null,
            ]
          );
        }
      }

      // ── 5. Insert items ────────────────────────────────────────────────
      if (flatItems.length > 0) {
        for (const item of flatItems) {
          await connection.queryArray(
            \`INSERT INTO public.items (id, list_id, name, status, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)\`,
            [
              item.id,
              item.list_id,
              item.name,
              item.status ?? "pending",
              item.created_at ?? new Date().toISOString(),
              item.updated_at ?? new Date().toISOString(),
              item.deleted_at ?? null,
            ]
          );
        }
      }

      // ── 6. Insert runs ─────────────────────────────────────────────────
      if (Array.isArray(runs_storage)) {
        for (const run of runs_storage) {
          await connection.queryArray(
            \`INSERT INTO public.runs (id, item_id, started_at, ended_at, duration, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\`,
            [
              run.id,
              run.item_id,
              run.started_at ?? null,
              run.ended_at ?? null,
              run.duration ?? null,
              run.created_at ?? new Date().toISOString(),
              run.updated_at ?? new Date().toISOString(),
              run.deleted_at ?? null,
            ]
          );
        }
      }

      // ── 7. Insert list shares ──────────────────────────────────────────
      if (Array.isArray(list_shares_storage)) {
        for (const share of list_shares_storage) {
          await connection.queryArray(
            \`INSERT INTO public.list_shares (id, list_id, shared_with_user_id, permission, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)\`,
            [
              share.id,
              share.list_id,
              share.shared_with_user_id,
              share.permission ?? "viewer",
              share.created_at ?? new Date().toISOString(),
              share.updated_at ?? new Date().toISOString(),
            ]
          );
        }
      }

      // ── 8. Record sync log ─────────────────────────────────────────────
      const payloadSize = JSON.stringify(body).length;
      await connection.queryArray(
        \`INSERT INTO public.sync_logs (user_id, operation, payload_size, success, created_at)
         VALUES ($1, $2, $3, $4, $5)\`,
        [owner_id, "push", payloadSize, true, new Date().toISOString()]
      );

      await connection.queryArray("COMMIT");

      return new Response(
        JSON.stringify({ success: true, message: "Sync completed." }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } catch (err) {
      await connection.queryArray("ROLLBACK").catch(() => {});
      console.error("Transaction error:", err.message);
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("sync-push error:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Sync failed." }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
`;
}

/**
 * Generate the sync-pull Edge Function
 */
function generateSyncPullFunction() {
  return `import { postgres } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
};

// ─────────────────────────────────────────────────────────────────────
// Helper: Decode JWT without verification (Edge Functions pattern)
// ─────────────────────────────────────────────────────────────────────

function decodeJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token format");
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Edge Function: GET /api/sync (full-state pull)
// ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Extract auth token from Authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing or invalid Authorization header." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // 2. Decode JWT (DO NOT call supabase.auth.getUser - it times out)
    const payload = decodeJWT(token);
    if (!payload || !payload.sub) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid token." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const owner_id = payload.sub;
    // 3. Connect to Postgres via Supabase
    const pool = new postgres.Pool(Deno.env.get("DATABASE_URL") || "", {
      max: 5,
    });

    const connection = await pool.connect();

    try {
      // Fetch all data owned by this user

      // Users
      const usersResult = await connection.queryArray(
        "SELECT id, email, first_name, last_name, created_at, updated_at FROM public.users WHERE id = $1",
        [owner_id]
      );
      const user_record = usersResult.rows[0] || null;

      // App settings
      const settingsResult = await connection.queryArray(
        "SELECT * FROM public.app_settings WHERE user_id = $1",
        [owner_id]
      );
      const app_settings = settingsResult.rows[0] || null;

      // Lists
      const listsResult = await connection.queryArray(
        "SELECT * FROM public.lists WHERE owner_id = $1",
        [owner_id]
      );
      const lists_storage = listsResult.rows || [];

      // Items grouped by list_id
      const itemsResult = await connection.queryArray(
        "SELECT * FROM public.items WHERE list_id IN (SELECT id FROM public.lists WHERE owner_id = $1)",
        [owner_id]
      );
      const items_storage = {};
      for (const item of itemsResult.rows || []) {
        if (!items_storage[item.list_id]) {
          items_storage[item.list_id] = [];
        }
        items_storage[item.list_id].push(item);
      }

      // Runs
      const runsResult = await connection.queryArray(
        "SELECT r.* FROM public.runs r JOIN public.items i ON r.item_id = i.id WHERE i.list_id IN (SELECT id FROM public.lists WHERE owner_id = $1)",
        [owner_id]
      );
      const runs_storage = runsResult.rows || [];

      // List shares
      const sharesResult = await connection.queryArray(
        "SELECT * FROM public.list_shares WHERE list_id IN (SELECT id FROM public.lists WHERE owner_id = $1)",
        [owner_id]
      );
      const list_shares_storage = sharesResult.rows || [];

      // Build response
      const payload = {
        schema_version: 1,
        data: {
          users_storage: user_record,
          app_settings: app_settings,
          lists_storage,
          items_storage,
          runs_storage,
          list_shares_storage,
        },
      };

      // Record sync log
      await connection.queryArray(
        "INSERT INTO public.sync_logs (user_id, operation, payload_size, success, created_at) VALUES ($1, $2, $3, $4, $5)",
        [owner_id, "pull", JSON.stringify(payload).length, true, new Date().toISOString()]
      );

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("sync-pull error:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Sync pull failed." }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
`;
}

/**
 * Main build process
 */
function build() {
  console.log("\n🔨 Building Edge Functions...\n");

  try {
    ensureDir(SUPABASE_FUNCTIONS_DIR);

    // Generate sync-push
    const syncPushPath = path.join(SUPABASE_FUNCTIONS_DIR, 'sync-push', 'index.ts');
    ensureDir(path.dirname(syncPushPath));
    fs.writeFileSync(syncPushPath, generateSyncPushFunction());
    console.log(`✓ Generated: supabase/functions/sync-push/index.ts`);

    // Generate sync-pull
    const syncPullPath = path.join(SUPABASE_FUNCTIONS_DIR, 'sync-pull', 'index.ts');
    ensureDir(path.dirname(syncPullPath));
    fs.writeFileSync(syncPullPath, generateSyncPullFunction());
    console.log(`✓ Generated: supabase/functions/sync-pull/index.ts`);

    console.log("\n✅ Build complete! Ready to deploy.\n");
    console.log("Next steps:");
    console.log("  1. Test locally: supabase functions serve");
    console.log("  2. Deploy: supabase functions deploy sync-push sync-pull");
    console.log("  3. Verify: supabase functions list\n");
  } catch (error) {
    console.error("❌ Build failed:", error.message);
    process.exit(1);
  }
}

// Run the build
build();
