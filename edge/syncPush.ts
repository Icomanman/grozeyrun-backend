import { parseErrorMessage } from './utils';
import { validateSyncPayload, validateOwnership } from './validation';

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

export type SyncPayload = {
  items_storage: Record<string, any[]>;
  lists_storage: any[];
  runs_storage: any[];
  users_storage?: Record<string, any>;
  app_settings?: Record<string, any>;
  list_shares_storage?: any[];
};

type SyncPushInput = {
  schema_version: number;
  user_id: string;
  data: unknown;
  data_size: number;
  db: any;
};

type SyncPushResult = {
  success: boolean;
  message: string;
};

/**
 * Core sync push logic — framework-agnostic.
 * 
 * Transaction order:
 *   1. Upsert public.users profile (never writes password_hash)
 *   2. Upsert public.app_settings
 *   3. DELETE public.lists WHERE owner_id = ? ← cascades to items, runs, list_shares
 *   4. INSERT public.lists
 *   5. INSERT public.items (items_storage is Record<listId, Item[]> — flattened here)
 *   6. INSERT public.runs
 *   7. INSERT public.list_shares
 *   8. INSERT public.sync_logs (success record)
 *
 * Any failure rolls back the entire transaction.
 */
export default async function syncPush({
  schema_version,
  user_id,
  data,
  data_size,
  db,
}: SyncPushInput): Promise<SyncPushResult> {
  const owner_id = user_id;
  const sql = db;

  if (!SUPPORTED_SCHEMA_VERSIONS.has(schema_version)) {
    throw new Error(`> Unsupported schema version: ${schema_version}.`);
  }

  // Validate payload structure
  const payloadError = validateSyncPayload(data);
  if (payloadError) {
    throw new Error(payloadError);
  }

  // Validate ownership
  const ownershipError = validateOwnership(data as Record<string, any>, owner_id);
  if (ownershipError) {
    throw new Error(ownershipError);
  }

  const {
    items_storage,
    lists_storage,
    runs_storage,
    users_storage,
    app_settings,
    list_shares_storage,
  } = data as SyncPayload;

  // Flatten items_storage (Record<listId, Item[]> → Item[])
  const flatItems = Object.values(items_storage ?? {}).flat();

  try {
    await sql.begin(async (tx: any) => {
      // ── 1. Upsert user profile ──────────────────────────────────────────
      // password_hash is intentionally omitted: Supabase Auth owns it.
      if (users_storage) {
        await tx`
          INSERT INTO public.users (id, email, first_name, last_name, created_at, updated_at)
          VALUES (
            ${owner_id},
            ${users_storage.email ?? null},
            ${users_storage.first_name ?? null},
            ${users_storage.last_name ?? null},
            ${users_storage.created_at ?? new Date()},
            ${users_storage.updated_at ?? new Date()}
          )
          ON CONFLICT (id) DO UPDATE SET
            email      = EXCLUDED.email,
            first_name = EXCLUDED.first_name,
            last_name  = EXCLUDED.last_name,
            updated_at = EXCLUDED.updated_at
        `;
      }

      // ── 2. Upsert app settings ──────────────────────────────────────────
      if (app_settings) {
        await tx`
          INSERT INTO public.app_settings
            (user_id, budget, currency, max_hours, notifications, period, theme, updated_at)
          VALUES (
            ${owner_id},
            ${app_settings.budget ?? null},
            ${app_settings.currency ?? null},
            ${app_settings.max_hours ?? null},
            ${app_settings.notifications ?? true},
            ${app_settings.period ?? 'monthly'},
            ${app_settings.theme ?? 'light'},
            ${app_settings.updated_at ?? new Date()}
          )
          ON CONFLICT (user_id) DO UPDATE SET
            budget        = EXCLUDED.budget,
            currency      = EXCLUDED.currency,
            max_hours     = EXCLUDED.max_hours,
            notifications = EXCLUDED.notifications,
            period        = EXCLUDED.period,
            theme         = EXCLUDED.theme,
            updated_at    = EXCLUDED.updated_at
        `;
      }

      // ── 3. Full-state replace: delete all lists ─────────────────────────
      // CASCADE propagates to: items, runs, list_shares
      await tx`DELETE FROM public.lists WHERE owner_id = ${owner_id}`;

      // ── 4. Insert lists ─────────────────────────────────────────────────
      if (lists_storage?.length > 0) {
        const listRows = lists_storage.map((l: any) => ({
          id: l.id,
          created_at: l.created_at ?? new Date(),
          description: l.description ?? null,
          is_shared: l.is_shared ?? false,
          item_count: l.item_count ?? 0,
          name: l.name,
          owner_id,
          total_cost: l.total_cost ?? 0,
          updated_at: l.updated_at ?? new Date(),
        }));
        await tx`INSERT INTO public.lists ${tx(listRows)}`;
      }

      // ── 5. Insert items (flattened from Record<listId, Item[]>) ──────────
      if (flatItems.length > 0) {
        const itemRows = flatItems.map((item: any) => ({
          id: item.id,
          category: item.category ?? null,
          completed: item.completed ?? false,
          created_at: item.created_at ?? new Date(),
          currency: item.currency ?? null,
          description: item.description ?? null,
          list_id: item.list_id,
          notes: item.notes ?? null,
          owner_id,
          quantity: item.quantity ?? null,
          text: item.text,
          unit: item.unit ?? null,
          unit_price: item.unit_price ?? null,
          updated_at: item.updated_at ?? new Date(),
        }));
        await tx`INSERT INTO public.items ${tx(itemRows)}`;
      }

      // ── 6. Insert runs ──────────────────────────────────────────────────
      if (runs_storage?.length > 0) {
        const runRows = runs_storage.map((r: any) => ({
          id: r.id,
          completion_date: r.completion_date ?? null,
          created_at: r.created_at ?? new Date(),
          description: r.description ?? null,
          is_completed: r.is_completed ?? false,
          list_id: r.list_id,
          name: r.name ?? null,
          owner_id,
          total_time: r.total_time ?? null,
          updated_at: r.updated_at ?? new Date(),
        }));
        await tx`INSERT INTO public.runs ${tx(runRows)}`;
      }

      // ── 7. Insert list_shares ───────────────────────────────────────────
      // list_shares reference lists already inserted above, so they go last
      // among the data tables. The authenticated user must be the owner of the
      // shared list — user_id of each share is the invited party, not the owner.
      if (list_shares_storage?.length > 0) {
        const shareRows = list_shares_storage.map((s: any) => ({
          id: s.id,
          grocery_list_id: s.grocery_list_id,
          invited_at: s.invited_at ?? new Date(),
          permission: s.permission,
          user_id: s.user_id,
        }));
        await tx`INSERT INTO public.list_shares ${tx(shareRows)}`;
      }

      // ── 8. Log the push (inside transaction — rolls back on failure) ────
      await tx`
        INSERT INTO public.sync_logs
          (id, data_size, schema_version, success, sync_type, user_id)
        VALUES
          (gen_random_uuid(), ${data_size}, ${String(schema_version)}, true, 'push', ${owner_id})
      `;
    });

    return {
      success: true,
      message: 'Sync successful.',
    };
  } catch (err: unknown) {
    const errorMessage: string = parseErrorMessage(err);
    console.error('[sync push] error:', errorMessage);

    // Best-effort failure log — intentionally outside the rolled-back transaction
    sql`
      INSERT INTO public.sync_logs
        (id, data_size, schema_version, success, sync_type, user_id, message)
      VALUES
        (gen_random_uuid(), ${data_size}, ${String(schema_version)}, false, 'push', ${owner_id}, ${errorMessage})
    `.catch((logErr: unknown) =>
      console.error('[sync push] log write failed:', parseErrorMessage(logErr))
    );

    throw new Error(`Sync push failed with:\n***\n${errorMessage}\n***`);
  }
}
