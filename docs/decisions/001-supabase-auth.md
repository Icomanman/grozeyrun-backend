# ADR-001: Use Supabase Auth for Session Management

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | April 11, 2026 |
| **Deciders** | Project owner |

---

## Context

The original backend design planned to implement authentication from scratch inside `services.cjs`: custom session tokens, a token storage table, manual verification middleware, and full auth routes (`/register`, `/login`, `/logout`, `/profile`).

During security review, the following problems were identified with that approach:

1. **Non-expiring tokens.** Tokens were never invalidated except on logout. A stolen token would grant permanent account access.
2. **No token storage mechanism.** There was no table or strategy to store and validate issued tokens server-side.
3. **Device binding is not a cryptographic guarantee.** Tying tokens to device identifiers provides friction but can be spoofed on rooted/jailbroken devices.
4. **Undifferentiated maintenance burden.** Building secure, battle-tested auth from scratch diverts effort from the backend's core responsibility: sync operations.

---

## Decision

Delegate all session management to **Supabase Auth**.

- The mobile app uses the Supabase Auth SDK directly for registration, login, logout, and profile management.
- The Express backend is NOT involved in auth flows. It retains only `POST /sync` and `GET /sync`.
- Every request to Express carries a Supabase-issued JWT in the `Authorization: Bearer <token>` header.
- Express verifies the token by calling `supabase.auth.getUser(token)` and extracts the authenticated `user.id` server-side. This `user.id` is used as `owner_id` for all database operations — it is never accepted from the request body.

---

## Alternatives Considered

### Custom JWT with expiry
Add expiry (e.g., 90 days) to the planned custom token. Requires building token refresh logic, a tokens table, and rotation handling. More work for equivalent security to a mature provider.

### Auth0 / Firebase Auth
Viable alternatives to Supabase Auth. Rejected because the database is already hosted on Supabase — co-locating auth on the same platform reduces operational complexity and keeps credentials unified.

### No auth layer change
Continue with scratch implementation. Rejected due to the security risks listed in Context, and because the implementation effort is not proportional to the backend's intended scope.

---

## Consequences

**Positive:**
- Token lifecycle (expiry, refresh, rotation) is handled by Supabase transparently. Users never need to re-login.
- No token storage table needed in the database.
- Express middleware simplifies to a single `supabase.auth.getUser()` call per request.
- Auth routes removed from Express — `services.cjs` is significantly smaller.
- Device sessions are managed by Supabase's session model.

**Negative / Trade-offs:**
- The mobile app has a direct dependency on the Supabase client SDK for auth.
- If Supabase Auth has an outage, login/logout is unavailable (sync via Express is unaffected if the token is already held).
- Supabase Auth's session model must be understood and configured correctly (e.g., JWT expiry settings in the Supabase dashboard).

---

## Implementation Notes

- Install `@supabase/supabase-js` in the Express backend (server-side JWT verification only).
- Supabase credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are held in `.env` on the backend only. The mobile app uses the `anon` public key.
- The service role key must never be exposed to the client.
