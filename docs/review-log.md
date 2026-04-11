# Security & Operational Review Log

> References: `requirements.tmp.md`
> Review date: April 11, 2026

This document is a historical trail of security and operational issues identified during design review of the backend requirements, data models, and database schema. It is not a specification — see `requirements.tmp.md` for that.

---

## Resolved Issues

### R1 — Client-side password hashing
**Issue:** The original requirements passed `old_password_hash` and `new_password_hash` from the client. This leaks the hashing algorithm to the client and weakens the security model.
**Resolution:** Requirements updated. Passwords are sent in plaintext over HTTPS and hashed server-side only. The `PUT /profile` input now uses `old_password` and `new_password`.

### R2 — Rate limiting scope too narrow
**Issue:** Rate limiting was specified per IP only. Mobile users behind carrier-grade NAT (CGNAT) share IPs, making IP-only limits both too loose (for attackers) and too tight (for legitimate users).
**Resolution:** Requirements updated to rate-limit per IP **and** per email on both `/login` and `/register`.

### R3 — No payload size cap on sync
**Issue:** `POST /sync` accepted unbounded payloads, creating a DoS vector.
**Resolution:** Requirements updated. Large payloads are rejected with an appropriate error message.

### R4 — `runs` table missing `updated_at`
**Issue:** The merge logic in sync depends on `updated_at` on every entity. The `runs` table did not have this column.
**Resolution:** Schema updated. `updated_at` added to the `runs` table.

### R5 — No atomicity on sync
**Issue:** A partial failure in `POST /sync` (e.g., lists written, items failed) would leave the database in an inconsistent state.
**Resolution:** Requirements updated. The sync operation is wrapped in a DB transaction.

---

## Resolved by Architecture Decision

### A1 — Non-expiring tokens
**Issue:** Non-expiring tokens grant permanent access if stolen. Planned device binding is a friction measure, not a cryptographic guarantee.
**Resolution:** Delegated to Supabase Auth. See [ADR-001](decisions/001-supabase-auth.md).

### A2 — Custom token storage and verification
**Issue:** No mechanism existed to store or verify session tokens server-side.
**Resolution:** Delegated to Supabase Auth. See [ADR-001](decisions/001-supabase-auth.md).

### A3 — Custom auth routes in Express
**Issue:** `/register`, `/login`, `/logout`, `/profile` were being implemented from scratch in `services.cjs`.
**Resolution:** Removed from Express. Mobile app calls Supabase Auth SDK directly. See [ADR-001](decisions/001-supabase-auth.md).

---

## Accepted by Design

### D1 — Client `updatedAt` drives merge logic
**Issue:** Client-supplied timestamps as the merge authority are spoofable.
**Accepted because:** The database is a non-authoritative snapshot, not the source of truth. The mobile app's AsyncStorage is authoritative. Client always wins on conflict by design. See [ADR-002](decisions/002-async-periodic-sync.md).

### D2 — No soft delete / tombstone strategy
**Issue:** Deletions made locally before a sync would silently reappear on the next pull with a delta-merge strategy.
**Accepted because:** Sync is full-state replacement, not delta merge. The current state of AsyncStorage is pushed in full; deleted records are simply absent. See [ADR-002](decisions/002-async-periodic-sync.md).

### D3 — Denormalized `item_count` / `total_cost` in `lists`
**Issue:** These fields could be stale if the sync pushes an outdated batch.
**Accepted because:** The DB receives whatever the app holds. Data integrity is the app's responsibility. The DB is a backup, not a computed source.

### D4 — `ItemsMap` ↔ DB impedance mismatch
**Issue:** The mobile stores items as `Record<string, ListItem[]>` (keyed by `listId`), while the DB stores flat rows.
**Accepted because:** `ItemsMap` is a frontend-only type. Flattening/structuring is handled by the sync layer at the boundary.

### D5 — 72-hour sync interval data loss window
**Issue:** Data created between syncs is lost if the device is lost or the app is deleted before the next sync.
**Accepted because:** The interval is arbitrary and configurable. The trade-off is a known consequence of the async/periodic design.

---

## Open Items

### O1 — `password` field in `IUserData`
**Issue:** `IUserData` in `dataModels.ts` contains a `password` field. If `users_storage` is included in the sync payload, this field travels over the wire.
**Action:** Remove `password` from `IUserData`. Password is a backend-only concern. Strip it from the type used in `UsersStorage`, or use a separate sync-safe type.

### O2 — Merge strategy ambiguity in requirements
**Issue:** `requirements.tmp.md` states *"diff and merge using `updatedAt`"* but the accepted design is full-state replacement. These are mutually exclusive.
**Action:** Update `requirements.tmp.md` to explicitly state full-state replacement for sync.

### O3 — Payload versioning not yet implemented
**Issue:** No mechanism to detect schema version mismatches between old app versions and the backend.
**Action:** Add `schema_version: number` as a top-level field in `POST /sync` and `GET /sync` payloads. Define as a constant in `constants/index.ts` in the mobile app. Backend rejects unsupported versions with `400`.
