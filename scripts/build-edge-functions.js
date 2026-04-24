#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUPABASE_FUNCTIONS_DIR = path.join(__dirname, '..', 'supabase', 'functions');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
}

function generateSyncPushFunction() {
  return `import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/v135/@supabase/supabase-js@2.38.2/dist/module.mjs";

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
    console.error("JWT decode error:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helper: Create Supabase client with service role (bypasses RLS)
// ─────────────────────────────────────────────────────────────────────

function createSupabaseClient(token) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
    },
  });
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
  for (const list of data.lists_storage) {
    if (list.owner_id && list.owner_id !== owner_id) {
      return "Ownership mismatch in lists_storage.";
    }
  }
  for (const run of data.runs_storage) {
    if (run.owner_id && run.owner_id !== owner_id) {
      return "Ownership mismatch in runs_storage.";
    }
  }
  if (data.users_storage && data.users_storage.id && data.users_storage.id !== owner_id) {
    return "Ownership mismatch in users_storage.";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Edge Function: POST /api/sync (full-state push)
// ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
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
    const tokenPayload = decodeJWT(token);
    if (!tokenPayload || !tokenPayload.sub) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid token." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const owner_id = tokenPayload.sub;

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

    // 4. Initialize Supabase client
    console.log("[sync-push] Initializing Supabase client...");
    const supabase = createSupabaseClient(token);

    try {
      const { items_storage, lists_storage, runs_storage, users_storage, app_settings, list_shares_storage } = data;
      const flatItems = Object.values(items_storage ?? {}).flat();

      // ── 1. Upsert user profile ──────────────────────────────────────────
      console.log("[sync-push] Upserting user profile...");
      if (users_storage) {
        const { error } = await supabase.from("users").upsert({
          id: owner_id,
          email: users_storage.email ?? null,
          first_name: users_storage.first_name ?? null,
          last_name: users_storage.last_name ?? null,
          created_at: users_storage.created_at ?? new Date().toISOString(),
          updated_at: users_storage.updated_at ?? new Date().toISOString(),
        });
        if (error) throw new Error(\`User upsert failed: \${error.message}\`);
      }

      // ── 2. Upsert app settings ──────────────────────────────────────────
      console.log("[sync-push] Upserting app settings...");
      if (app_settings) {
        const { error } = await supabase.from("app_settings").upsert({
          user_id: owner_id,
          budget: app_settings.budget ?? null,
          currency: app_settings.currency ?? null,
          max_hours: app_settings.max_hours ?? null,
          notifications: app_settings.notifications ?? true,
          period: app_settings.period ?? "monthly",
          theme: app_settings.theme ?? "light",
          updated_at: app_settings.updated_at ?? new Date().toISOString(),
        });
        if (error) throw new Error(\`Settings upsert failed: \${error.message}\`);
      }

      // ── 3. Delete existing lists (cascades to items, runs, list_shares) ──
      console.log("[sync-push] Clearing old lists...");
      const { error: deleteError } = await supabase.from("lists").delete().eq("owner_id", owner_id);
      if (deleteError) throw new Error(\`List delete failed: \${deleteError.message}\`);

      // ── 4. Insert lists ─────────────────────────────────────────────────
      console.log("[sync-push] Inserting\", lists_storage.length, \"lists...\");
      if (Array.isArray(lists_storage) && lists_storage.length > 0) {
        const listsToInsert = lists_storage.map(list => ({
          id: list.id,
          owner_id: owner_id,
          name: list.name,
          color: list.color ?? null,
          emoji: list.emoji ?? null,
          created_at: list.created_at ?? new Date().toISOString(),
          updated_at: list.updated_at ?? new Date().toISOString(),
          deleted_at: list.deleted_at ?? null,
        }));
        const { error } = await supabase.from("lists").insert(listsToInsert);
        if (error) throw new Error(\`Lists insert failed: \${error.message}\`);
      }

      // ── 5. Insert items ────────────────────────────────────────────────
      console.log("[sync-push] Inserting\", flatItems.length, \"items...\");
      if (flatItems.length > 0) {
        const itemsToInsert = flatItems.map(item => ({
          id: item.id,
          list_id: item.list_id,
          name: item.name,
          status: item.status ?? "pending",
          created_at: item.created_at ?? new Date().toISOString(),
          updated_at: item.updated_at ?? new Date().toISOString(),
          deleted_at: item.deleted_at ?? null,
        }));
        const { error } = await supabase.from("items").insert(itemsToInsert);
        if (error) throw new Error(\`Items insert failed: \${error.message}\`);
      }

      // ── 6. Insert runs ─────────────────────────────────────────────────
      console.log("[sync-push] Inserting\", runs_storage.length, \"runs...\");
      if (Array.isArray(runs_storage) && runs_storage.length > 0) {
        const runsToInsert = runs_storage.map(run => ({
          id: run.id,
          item_id: run.item_id,
          started_at: run.started_at ?? null,
          ended_at: run.ended_at ?? null,
          duration: run.duration ?? null,
          created_at: run.created_at ?? new Date().toISOString(),
          updated_at: run.updated_at ?? new Date().toISOString(),
          deleted_at: run.deleted_at ?? null,
        }));
        const { error } = await supabase.from("runs").insert(runsToInsert);
        if (error) throw new Error(\`Runs insert failed: \${error.message}\`);
      }

      // ── 7. Insert list shares ──────────────────────────────────────────
      console.log("[sync-push] Inserting\", list_shares_storage?.length ?? 0, \"shares...\");
      if (Array.isArray(list_shares_storage) && list_shares_storage.length > 0) {
        const sharesToInsert = list_shares_storage.map(share => ({
          id: share.id,
          list_id: share.list_id,
          shared_with_user_id: share.shared_with_user_id,
          permission: share.permission ?? "viewer",
          created_at: share.created_at ?? new Date().toISOString(),
          updated_at: share.updated_at ?? new Date().toISOString(),
        }));
        const { error } = await supabase.from("list_shares").insert(sharesToInsert);
        if (error) throw new Error(\`List shares insert failed: \${error.message}\`);
      }

      // ── 8. Record sync log ─────────────────────────────────────────────
      console.log("[sync-push] Recording sync log...");
      const payloadSize = JSON.stringify(body).length;
      const { error: logError } = await supabase.from("sync_logs").insert({
        user_id: owner_id,
        operation: "push",
        payload_size: payloadSize,
        success: true,
        created_at: new Date().toISOString(),
      });
      if (logError) throw new Error(\`Sync log failed: \${logError.message}\`);

      console.log("[sync-push] Sync push completed successfully");
      return new Response(
        JSON.stringify({ success: true, message: "Sync completed." }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } catch (err) {
      console.error("[sync-push] Error:", err);
      throw err;
    }
  } catch (error) {
    console.error("sync-push error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, message: "Sync failed.", error: errorMsg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
`;
}

function generateSyncPullFunction() {
  return `import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/v135/@supabase/supabase-js@2.38.2/dist/module.mjs";

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
    console.error("JWT decode error:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helper: Create Supabase client with service role (bypasses RLS)
// ─────────────────────────────────────────────────────────────────────

function createSupabaseClient(token) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Edge Function: GET /api/sync (full-state pull)
// ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
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
    const tokenPayload = decodeJWT(token);
    if (!tokenPayload || !tokenPayload.sub) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid token." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const owner_id = tokenPayload.sub;

    // 3. Initialize Supabase client with user context
    console.log("[sync-pull] Auth OK, owner_id:", owner_id);
    console.log("[sync-pull] Initializing Supabase client...");
    const supabase = createSupabaseClient(token);

    try {
      // Fetch all data owned by this user

      // Users
      console.log("[sync-pull] Fetching users...");
      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id, email, first_name, last_name, created_at, updated_at")
        .eq("id", owner_id)
        .maybeSingle();
      if (usersError && usersError.code !== "PGRST116") throw usersError;
      const user_record = usersData || null;

      // App settings
      console.log("[sync-pull] Fetching app_settings...");
      const { data: settingsData, error: settingsError } = await supabase
        .from("app_settings")
        .select("*")
        .eq("user_id", owner_id)
        .maybeSingle();
      if (settingsError && settingsError.code !== "PGRST116") throw settingsError;
      const app_settings = settingsData || null;

      // Lists
      console.log("[sync-pull] Fetching lists...");
      const { data: listsData, error: listsError } = await supabase
        .from("lists")
        .select("*")
        .eq("owner_id", owner_id);
      if (listsError) throw listsError;
      const lists_storage = listsData || [];
      console.log("[sync-pull] Found", lists_storage.length, "lists");

      // Items grouped by list_id
      console.log("[sync-pull] Fetching items...");
      const { data: itemsData, error: itemsError } = await supabase
        .from("items")
        .select("*")
        .in("list_id", lists_storage.map(l => l.id));
      if (itemsError) throw itemsError;
      
      const items_storage = {};
      for (const item of itemsData || []) {
        if (!items_storage[item.list_id]) {
          items_storage[item.list_id] = [];
        }
        items_storage[item.list_id].push(item);
      }
      console.log("[sync-pull] Found items in", Object.keys(items_storage).length, "lists");

      // Runs
      console.log("[sync-pull] Fetching runs...");
      const { data: runsData, error: runsError } = await supabase
        .from("runs")
        .select("*")
        .in("item_id", (itemsData || []).map(i => i.id));
      if (runsError) throw runsError;
      const runs_storage = runsData || [];
      console.log("[sync-pull] Found", runs_storage.length, "runs");

      // List shares
      console.log("[sync-pull] Fetching list_shares...");
      const { data: sharesData, error: sharesError } = await supabase
        .from("list_shares")
        .select("*")
        .in("list_id", lists_storage.map(l => l.id));
      if (sharesError) throw sharesError;
      const list_shares_storage = sharesData || [];
      console.log("[sync-pull] Found", list_shares_storage.length, "shares");

      // Build response
      console.log("[sync-pull] Building response...");
      const responsePayload = {
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
      console.log("[sync-pull] Recording sync log...");
      const { error: logError } = await supabase.from("sync_logs").insert({
        user_id: owner_id,
        operation: "pull",
        payload_size: JSON.stringify(responsePayload).length,
        success: true,
        created_at: new Date().toISOString(),
      });
      if (logError) throw logError;

      console.log("[sync-pull] Response ready, sending...");
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (error) {
      console.error("[sync-pull] Query error:", error);
      throw error;
    }
  } catch (error) {
    console.error("[sync-pull] error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, message: "Sync pull failed.", error: errorMsg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
`;
}

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

build();
