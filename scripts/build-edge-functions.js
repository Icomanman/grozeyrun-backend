#!/usr/bin/env node
'use strict';

/**
 * Build script: Converts Node.js Express backend to Supabase Edge Functions
 * 
 * This script:
 * 1. Reads the CommonJS backend code
 * 2. Generates TypeScript Edge Functions compatible with Deno
 * 3. Outputs to supabase/functions/ directory
 * 
 * Run with: npm run build:edge
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../supabase/functions');
const BACKEND_DIR = path.join(__dirname, '..');

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
 * Generate sync-push Edge Function (POST /api/sync)
 */
function generateSyncPushFunction() {
  const content = `import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0';

// Types
interface SyncPayload {
  schema_version: number;
  data: {
    items_storage: Record<string, any[]>;
    lists_storage: any[];
    runs_storage: any[];
    users_storage: any;
    app_settings: any;
    list_shares_storage?: any[];
  };
}

interface RequestBody {
  schema_version: number;
  data: any;
}

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

/**
 * Validates the top-level structure of the sync data payload.
 */
function validateSyncPayload(data: any): string | null {
  const REQUIRED_DATA_KEYS = ['items_storage', 'lists_storage', 'runs_storage', 'users_storage', 'app_settings'];
  const OPTIONAL_ARRAY_KEYS = ['list_shares_storage'];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Missing or invalid data payload.';
  }
  for (const key of REQUIRED_DATA_KEYS) {
    if (!(key in data)) {
      return \`Missing required field: data.\${key}.\`;
    }
  }
  if (typeof data.items_storage !== 'object' || Array.isArray(data.items_storage)) {
    return 'data.items_storage must be a plain object (Record<listId, ListItem[]>).';
  }
  if (!Array.isArray(data.lists_storage)) {
    return 'data.lists_storage must be an array.';
  }
  if (!Array.isArray(data.runs_storage)) {
    return 'data.runs_storage must be an array.';
  }
  if (typeof data.users_storage !== 'object' || Array.isArray(data.users_storage)) {
    return 'data.users_storage must be a plain object.';
  }
  if (typeof data.app_settings !== 'object' || Array.isArray(data.app_settings)) {
    return 'data.app_settings must be a plain object.';
  }
  for (const key of OPTIONAL_ARRAY_KEYS) {
    if (key in data && !Array.isArray(data[key])) {
      return \`data.\${key} must be an array when present.\`;
    }
  }
  return null;
}

/**
 * Validates that the authenticated user owns the data
 */
function validateOwnership(data: any, owner_id: string): string | null {
  if (data.users_storage?.id && data.users_storage.id !== owner_id) {
    return 'User ID mismatch: cannot sync data for another user.';
  }
  if (data.lists_storage?.length > 0) {
    if (data.lists_storage.some((list: any) => list.owner_id !== owner_id)) {
      return 'Ownership violation: lists must belong to authenticated user.';
    }
  }
  return null;
}

/**
 * Extracts user_id from the Supabase auth context.
 * The 'x-user-id' header is set by Supabase's authorization layer
 * when a valid JWT is provided.
 */
function verifyAuth(req: Request): string | null {
  // Supabase sets x-user-id header when auth is successful
  const userId = req.headers.get('x-user-id');
  if (userId) {
    return userId;
  }

  // Fallback: try to extract from Authorization header if Supabase auth context isn't available
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  // Extract just the sub claim from JWT without verification
  try {
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(
        Deno.core.decode(parts[1])
      )
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Verify auth
    const owner_id = verifyAuth(req);
    if (!owner_id) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid or missing authorization' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: RequestBody = await req.json();
    const { schema_version, data } = body;

    // Validate schema version
    if (!SUPPORTED_SCHEMA_VERSIONS.has(Number(schema_version))) {
      return new Response(
        JSON.stringify({ success: false, message: \`Unsupported schema_version: \${schema_version}.\` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate payload
    const payloadError = validateSyncPayload(data);
    if (payloadError) {
      return new Response(
        JSON.stringify({ success: false, message: payloadError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate ownership
    const ownerError = validateOwnership(data, owner_id);
    if (ownerError) {
      return new Response(
        JSON.stringify({ success: false, message: ownerError }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const payloadSize = Buffer.byteLength(JSON.stringify(body), 'utf8');
    const { items_storage, lists_storage, runs_storage, users_storage, app_settings, list_shares_storage } = data;
    const flatItems = Object.values(items_storage ?? {}).flat();

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Execute database operations
    const { error: userError } = await supabase
      .from('users')
      .upsert({
        id: owner_id,
        email: users_storage?.email ?? null,
        first_name: users_storage?.first_name ?? null,
        last_name: users_storage?.last_name ?? null,
        created_at: users_storage?.created_at ?? new Date().toISOString(),
        updated_at: users_storage?.updated_at ?? new Date().toISOString(),
      });

    if (userError) {
      throw new Error(\`Failed to upsert user: \${userError.message}\`);
    }

    // Upsert app settings
    const { error: settingsError } = await supabase
      .from('app_settings')
      .upsert({
        user_id: owner_id,
        budget: app_settings?.budget ?? null,
        currency: app_settings?.currency ?? null,
        max_hours: app_settings?.max_hours ?? null,
        notifications: app_settings?.notifications ?? true,
        period: app_settings?.period ?? 'monthly',
        theme: app_settings?.theme ?? 'light',
        updated_at: app_settings?.updated_at ?? new Date().toISOString(),
      });

    if (settingsError) {
      throw new Error(\`Failed to upsert settings: \${settingsError.message}\`);
    }

    // Delete all existing lists (cascade deletes items, runs, list_shares)
    const { error: deleteError } = await supabase
      .from('lists')
      .delete()
      .eq('owner_id', owner_id);

    if (deleteError) {
      throw new Error(\`Failed to delete lists: \${deleteError.message}\`);
    }

    // Insert new lists
    if (lists_storage?.length > 0) {
      const listRows = lists_storage.map((l: any) => ({
        id: l.id,
        created_at: l.created_at ?? new Date().toISOString(),
        description: l.description ?? null,
        is_shared: l.is_shared ?? false,
        item_count: l.item_count ?? 0,
        name: l.name,
        owner_id,
        total_cost: l.total_cost ?? 0,
        updated_at: l.updated_at ?? new Date().toISOString(),
      }));

      const { error: listError } = await supabase
        .from('lists')
        .insert(listRows);

      if (listError) {
        throw new Error(\`Failed to insert lists: \${listError.message}\`);
      }
    }

    // Insert items
    if (flatItems.length > 0) {
      const itemRows = flatItems.map((item: any) => ({
        id: item.id,
        category: item.category ?? null,
        completed: item.completed ?? false,
        created_at: item.created_at ?? new Date().toISOString(),
        currency: item.currency ?? null,
        description: item.description ?? null,
        list_id: item.list_id,
        notes: item.notes ?? null,
        owner_id,
        quantity: item.quantity ?? null,
        text: item.text,
        unit: item.unit ?? null,
        unit_price: item.unit_price ?? null,
        updated_at: item.updated_at ?? new Date().toISOString(),
      }));

      const { error: itemError } = await supabase
        .from('items')
        .insert(itemRows);

      if (itemError) {
        throw new Error(\`Failed to insert items: \${itemError.message}\`);
      }
    }

    // Insert runs
    if (runs_storage?.length > 0) {
      const runRows = runs_storage.map((r: any) => ({
        id: r.id,
        completion_date: r.completion_date ?? null,
        created_at: r.created_at ?? new Date().toISOString(),
        description: r.description ?? null,
        is_completed: r.is_completed ?? false,
        list_id: r.list_id,
        name: r.name ?? null,
        owner_id,
        total_time: r.total_time ?? null,
        updated_at: r.updated_at ?? new Date().toISOString(),
      }));

      const { error: runError } = await supabase
        .from('runs')
        .insert(runRows);

      if (runError) {
        throw new Error(\`Failed to insert runs: \${runError.message}\`);
      }
    }

    // Insert list shares
    if (list_shares_storage?.length > 0) {
      const shareRows = list_shares_storage.map((s: any) => ({
        id: s.id,
        grocery_list_id: s.grocery_list_id,
        invited_at: s.invited_at ?? new Date().toISOString(),
        permission: s.permission,
        user_id: s.user_id,
      }));

      const { error: shareError } = await supabase
        .from('list_shares')
        .insert(shareRows);

      if (shareError) {
        throw new Error(\`Failed to insert list shares: \${shareError.message}\`);
      }
    }

    // Log the sync
    await supabase
      .from('sync_logs')
      .insert({
        data_size: payloadSize,
        schema_version: String(schema_version),
        success: true,
        sync_type: 'push',
        user_id: owner_id,
      });

    return new Response(
      JSON.stringify({ success: true, message: 'Sync successful.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync push error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Sync failed. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
`;

  return content;
}

/**
 * Generate sync-pull Edge Function (GET /api/sync)
 */
function generateSyncPullFunction() {
  const content = `import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0';

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

/**
 * Extracts user_id from the Supabase auth context.
 * The 'x-user-id' header is set by Supabase's authorization layer
 * when a valid JWT is provided.
 */
function verifyAuth(req: Request): string | null {
  // Supabase sets x-user-id header when auth is successful
  const userId = req.headers.get('x-user-id');
  if (userId) {
    return userId;
  }

  // Fallback: try to extract from Authorization header if Supabase auth context isn't available
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  // Extract just the sub claim from JWT without verification
  try {
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(
        Deno.core.decode(parts[1])
      )
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Verify auth
    const owner_id = verifyAuth(req);
    if (!owner_id) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid or missing authorization' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get schema version from query
    const url = new URL(req.url);
    const schema_version = Number(url.searchParams.get('schema_version')) || 1;

    if (!SUPPORTED_SCHEMA_VERSIONS.has(schema_version)) {
      return new Response(
        JSON.stringify({ success: false, message: \`Unsupported schema_version: \${schema_version}.\` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Fetch all data in parallel
    const [usersData, settingsData, listsData, itemsData, runsData, sharesData] = await Promise.all([
      supabase
        .from('users')
        .select('id, email, first_name, last_name, created_at, updated_at')
        .eq('id', owner_id)
        .single()
        .catch(() => ({ data: null })),
      supabase
        .from('app_settings')
        .select('*')
        .eq('user_id', owner_id)
        .single()
        .catch(() => ({ data: null })),
      supabase
        .from('lists')
        .select('*')
        .eq('owner_id', owner_id),
      supabase
        .from('items')
        .select('*')
        .eq('owner_id', owner_id),
      supabase
        .from('runs')
        .select('*')
        .eq('owner_id', owner_id),
      supabase
        .from('list_shares')
        .select('*')
        .eq('user_id', owner_id),
    ]);

    // Reconstruct items_storage as Record<listId, Item[]>
    const items_storage: Record<string, any[]> = {};
    if (itemsData.data) {
      for (const item of itemsData.data) {
        if (!items_storage[item.list_id]) {
          items_storage[item.list_id] = [];
        }
        items_storage[item.list_id].push(item);
      }
    }

    // Log the pull (fire and forget)
    supabase
      .from('sync_logs')
      .insert({
        schema_version: String(schema_version),
        success: true,
        sync_type: 'pull',
        user_id: owner_id,
      })
      .catch((err) => console.error('Sync log error:', err));

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          users_storage: usersData.data ?? null,
          app_settings: settingsData.data ?? null,
          lists_storage: listsData.data ?? [],
          items_storage,
          runs_storage: runsData.data ?? [],
          list_shares_storage: sharesData.data ?? [],
        },
        message: 'Sync successful.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync pull error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Failed to retrieve data. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
`;

  return content;
}

/**
 * Main build function
 */
function build() {
  console.log('🔨 Building Edge Functions...\n');

  // Ensure directories exist
  const syncPushDir = path.join(OUTPUT_DIR, 'sync-push');
  const syncPullDir = path.join(OUTPUT_DIR, 'sync-pull');

  ensureDir(OUTPUT_DIR);
  ensureDir(syncPushDir);
  ensureDir(syncPullDir);

  // Generate sync-push
  const syncPushContent = generateSyncPushFunction();
  fs.writeFileSync(path.join(syncPushDir, 'index.ts'), syncPushContent);
  console.log('✓ Generated: supabase/functions/sync-push/index.ts');

  // Generate sync-pull
  const syncPullContent = generateSyncPullFunction();
  fs.writeFileSync(path.join(syncPullDir, 'index.ts'), syncPullContent);
  console.log('✓ Generated: supabase/functions/sync-pull/index.ts');

  // Create deno.json for Edge Functions
  const denoConfig = {
    imports: {
      'std/': 'https://deno.land/std@0.208.0/',
      '@supabase/': 'https://esm.sh/@supabase/',
    },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'deno.json'), JSON.stringify(denoConfig, null, 2));
  console.log('✓ Generated: supabase/functions/deno.json');

  console.log('\n✅ Build complete! Edge Functions ready for deployment.\n');
  console.log('Next steps:');
  console.log('  1. Verify supabase/functions/ structure');
  console.log('  2. Commit changes to git');
  console.log('  3. Push to repository (GitHub Actions will deploy automatically)');
  console.log('\nOr deploy manually:');
  console.log('  supabase functions deploy sync-push');
  console.log('  supabase functions deploy sync-pull');
}

build();
