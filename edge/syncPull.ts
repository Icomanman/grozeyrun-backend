
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

type SyncPullInput = {
    schema_version: number;
    user_id: string;
    db: any;
}

type SyncPullResult = {
    users_storage: Record<string, any> | null;
    app_settings: Record<string, any> | null;
    lists_storage: any[];
    items_storage: Record<string, any[]>;
    runs_storage: any[];
    list_shares_storage: any[];
};

export default async function syncPull({ user_id, schema_version, db }: SyncPullInput): Promise<SyncPullResult> {
    const owner_id = user_id
    const sql = db;

    if (!SUPPORTED_SCHEMA_VERSIONS.has(schema_version)) {
        throw new Error(`> Unsupported schema version: ${schema_version}.`);
    };

    try {
        const [users, settings, lists, items, runs, shares] = await Promise.all([
            sql`SELECT id, email, first_name, last_name, created_at, updated_at
                FROM public.users WHERE id = ${owner_id}`,
            sql`SELECT * FROM public.app_settings WHERE user_id = ${owner_id}`,
            sql`SELECT * FROM public.lists WHERE owner_id = ${owner_id}`,
            sql`SELECT * FROM public.items WHERE owner_id = ${owner_id}`,
            sql`SELECT * FROM public.runs  WHERE owner_id = ${owner_id}`,
            // Return shares for lists this user owns only
            sql`SELECT ls.* FROM public.list_shares ls
                INNER JOIN public.lists l ON l.id = ls.grocery_list_id
                WHERE l.owner_id = ${owner_id}`,
        ]);

        // Reconstruct items_storage as Record<listId, Item[]>
        const items_storage: Record<string, Array<any>> = {};
        for (const item of items) {
            if (!items_storage[item.list_id]) items_storage[item.list_id] = [];
            items_storage[item.list_id].push(item);
        }

        // Fire-and-forget pull log
        sql`
            INSERT INTO public.sync_logs
                (id, schema_version, success, sync_type, user_id)
            VALUES
                (gen_random_uuid(), ${String(schema_version)}, true, 'pull', ${owner_id})
        `.catch((logErr: any) => console.error('[sync pull] log write failed:', logErr.message));

        return {
            users_storage: users[0] ?? null,
            app_settings: settings[0] ?? null,
            lists_storage: lists,
            items_storage,
            runs_storage: runs,
            list_shares_storage: shares,
        };
    } catch (err: any) {
        console.error('[sync pull] error:', err.message);
        sql`
            INSERT INTO public.sync_logs
                (id, schema_version, success, sync_type, user_id, message)
            VALUES
                (gen_random_uuid(), ${String(schema_version)}, false, 'pull', ${owner_id}, ${err.message})
        `.catch((logErr: any) => console.error('[sync pull] log write failed:', logErr.message));

        throw new Error(); // we have to be explicit here what went wrong.
    }
};