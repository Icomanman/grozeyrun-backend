# ADR-002: Async, Periodic Full-State Sync

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | April 11, 2026 |
| **Deciders** | Project owner |

---

## Context

The backend needs to store and retrieve user-generated data (grocery lists, items, run history, app settings). The key design question is: **how and when does the mobile app exchange data with the backend?**

Standard approaches include:

- **Real-time sync** — every user action triggers an API call
- **Delta sync** — only changed records are sent, merged on each sync
- **Full-state periodic sync** — the entire local state is pushed/pulled at intervals or specific trigger points

---

## Decision

Use **full-state periodic sync**. The mobile app's `AsyncStorage` is the source of truth. The database is a backup snapshot, not a real-time ledger.

**Sync triggers:**
- Every ~72 hours (configurable interval)
- Manual sync initiated by the user
- On logout

**Sync shape:**
The sync payload is the full contents of AsyncStorage, structured as:

```json
{
  "schema_version": 1,
  "data": {
    "items_storage": { "<listId>": [ ...items ] },
    "lists_storage": [ ...lists ],
    "runs_storage": [ ...runs ],
    "users_storage": { ...user profile },
    "app_settings": { ...settings }
  }
}
```

**Push (`POST /sync`):** The backend receives the full payload and replaces the user's stored data. The operation is wrapped in a DB transaction — partial writes are rolled back.

**Pull (`GET /sync`):** The backend returns the last successfully stored full snapshot for the user.

**Conflict resolution:** The client's data always wins. `updatedAt` timestamps from the payload are stored as-is. No server-side merge arbitration.

---

## Alternatives Considered

### Real-time sync (per-action API calls)
Every create, update, and delete in the app triggers an immediate API call. Rejected because:
- Significantly increases backend load and database calls
- Requires network availability for every user action
- Contradicts the design goal of a thin, minimal backend

### Delta / diff merge sync
Only changed records are sent; the backend merges them with existing data using `updatedAt` timestamps.

Partially considered, then rejected in favour of full-state replacement because:
- Deletes cannot be represented without a tombstone/soft-delete strategy
- `updatedAt` from the client is spoofable — and for a non-authoritative backup, the complexity is not justified
- Full-state is simpler to implement correctly and reason about

---

## Consequences

**Positive:**
- `services.cjs` only needs two routes: `POST /sync` and `GET /sync`
- No tombstone or soft-delete strategy needed — absent records in the payload are simply not present in the backup
- Conflict resolution is trivial: client always wins
- Offline-first by default; the app never depends on network availability for individual actions

**Negative / Trade-offs:**
- **Data loss window:** If the device is lost or the app is deleted before a sync, up to ~72 hours of data may be lost. This is a known and accepted trade-off.
- **Payload size:** Full-state payloads grow with data volume. A payload size cap is enforced on `POST /sync` to prevent abuse.
- **No granular history:** The database holds only the last snapshot. There is no record of intermediate states.

---

## Implementation Notes

- `schema_version` must be included in every sync payload. The backend rejects unsupported versions with `400`. Define the version constant in the mobile app at `constants/index.ts`.
- `owner_id` is never accepted from the request body. It is extracted server-side from the verified Supabase JWT (see [ADR-001](001-supabase-auth.md)).
- `IUserData.password` must be stripped from `users_storage` before it is included in any sync payload. The password field is a backend-only concern.
- Sync is logged to the `sync_logs` table (user, timestamp, direction, size, success/failure) for operational visibility.
