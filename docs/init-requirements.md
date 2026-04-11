# Thin Backend Layer Requirements

> See also: [ADR-001 — Supabase Auth](decisions/001-supabase-auth.md) | [ADR-002 — Async Periodic Sync](decisions/002-async-periodic-sync.md)

## Design Intent
**! CRITICAL**
The backend layer is designed to be thin and minimal. It serves ONLY ONE purpose:

### Async, periodic storage and retrieval of User-Generated Data

User authentication is fully delegated to **Supabase Auth**. The mobile app calls Supabase Auth directly for all auth flows. The Express backend is a secure transaction proxy for database operations only — it never handles credentials, never issues tokens, and never manages sessions.

* Our data management is asynchronous and periodic. The mobile app handles data storage and retrieval in batches via `AsyncStorage`, not through real-time API calls for each individual action. This minimises database calls while leaning on local storage. The database is a **backup snapshot** of the user's data, not a real-time source of truth.

* Sync triggers:
  * Periodic interval (configurable, default ~72 hours)
  * Manual sync initiated by the user
  * On logout

* During a sync (push), the mobile app sends the **full current state** of AsyncStorage to the backend. This is a full-state replacement — not a delta or diff merge. The backend overwrites the user's stored snapshot with the incoming payload.

* The sync payload shape:
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
  * `users_storage` must never include the user's password — strip it before sync.
  * `schema_version` is a number constant defined in the mobile app (`constants/index.ts`). Increment it manually on breaking data model changes.

* See "User-Generated Data" section below for more details.

#### User-Generated Data
* User-generated data includes:
  * App settings
  * Grocery lists
  * List items
  * Run data (completed lists with timestamps)
  * Shared lists and permissions


## Flows

### Auth Flows — Handled by Supabase Auth SDK (mobile app only, not Express)

1. **User Registration** — `supabase.auth.signUp({ email, password })`
   * Email uniqueness and password strength enforced by Supabase.
   * No token issued on registration. User must log in separately.
   * Email validation and password reset flows deferred to a later release.

2. **User Login** — `supabase.auth.signInWithPassword({ email, password })`
   * Returns a Supabase JWT. Token lifecycle (expiry, refresh, rotation) is managed by Supabase transparently — the user never needs to re-login.
   * Device session management is handled by Supabase's session model.

3. **User Logout** — `supabase.auth.signOut()`
   * Invalidates the current session token.
   * Must trigger a sync push before logout to preserve latest data.

4. **Get / Update User Profile** — `supabase.auth.getUser()` / `supabase.auth.updateUser()`
   * Profile management (username, email, password) handled via Supabase Auth.

---

### Express Routes — Sync only

The Express backend exposes exactly two routes. All requests must include a valid Supabase JWT in the `Authorization: Bearer <token>` header. The backend verifies the token via `supabase.auth.getUser(token)` and extracts `user.id` server-side. `owner_id` is never accepted from the request body.

5. **Sync User Data — Push**
   * Endpoint: `POST /api/sync`
   * Headers: `{ Authorization: Bearer <token> }`
   * Input:
     ```json
     {
       "schema_version": 1,
       "data": {
         "items_storage": { "<listId>": [ ...items ] },
         "lists_storage": [ ...lists ],
         "runs_storage": [ ...runs ],
         "users_storage": { ...user profile (no password field) },
         "app_settings": { ...settings }
       }
     }
     ```
   * Output: `{ success: boolean, message: string }`
   * Behaviour: Full-state replacement. The incoming payload overwrites the user's stored snapshot entirely. Wrapped in a DB transaction — any failure rolls back the entire operation.
   * Validation:
     * Reject unsupported `schema_version` with `400`.
     * Enforce a payload size cap — reject oversized payloads with `413`.
     * Validate structure of each nested storage object.
     * Verify `owner_id` on every nested record matches the authenticated user's JWT `user.id`.
   * Logging: Record to `sync_logs` (user, direction: push, size, success/failure).

6. **Sync User Data — Pull**
   * Endpoint: `GET /api/sync`
   * Headers: `{ Authorization: Bearer <token> }`
   * Input: `{ schema_version: number }` (query param)
   * Output:
     ```json
     {
       "success": true,
       "data": {
         "items_storage": { ... },
         "lists_storage": [ ... ],
         "runs_storage": [ ... ],
         "users_storage": { ... },
         "app_settings": { ... }
       },
       "message": "string"
     }
     ```
   * Behaviour: Returns the last successfully stored full snapshot for the authenticated user.
   * Validation: Reject unsupported `schema_version` with `400`.
   * Logging: Record to `sync_logs` (user, direction: pull, success/failure).

---

### Others
   * Additional logic and validations must live as much as possible in the mobile app.
   * The backend applies basic structural validations as a safety net, not as a primary guard.
   * The mobile app is the source of truth. The backend stores and returns snapshots only.


## Authentication

Fully delegated to **Supabase Auth**. See [ADR-001](decisions/001-supabase-auth.md).

* The mobile app uses the Supabase Auth SDK for all auth flows.
* The Express backend never handles credentials or issues tokens.
* Token lifecycle (expiry, refresh, rotation) is managed by Supabase — users do not need to re-login.
* The Express backend verifies every request by calling `supabase.auth.getUser(token)` and extracting `user.id` server-side.
* The Supabase service role key is held server-side in `.env` only and must never be exposed to the client.
* The mobile app uses the Supabase `anon` public key only.