# Supabase Edge Function Architecture (Sync)

## Overview

This document summarizes the architecture we arrived at for building a **robust, production-ready sync system** using Supabase Edge Functions.

The key idea is to **separate concerns clearly** between:

- Edge runtime (Deno)
- Core business logic (TypeScript)
- Database layer

---

## Core Principle

> TypeScript is not about typing everything — it is about controlling the boundaries.

We apply strict typing **only where we control the data**, and treat everything else as untrusted.

---

## High-Level Architecture

```
[ Client ]
     ↓
[ Edge Function (Deno) ]  ← handles HTTP + Auth + Parsing
     ↓
[ Core Logic (TypeScript) ] ← pure, fully typed business logic
     ↓
[ Database Layer ] ← controlled escape hatch
```

---

## Layer Responsibilities

### 1. Edge Function (Deno Runtime)

**Responsibility:**
- Handle HTTP request/response
- Extract and verify auth token
- Parse inputs (query, body, headers)
- Call core logic
- Map errors → HTTP responses

**Key rule:**
All external input is treated as `unknown`

```ts
const input: unknown = await req.json();
```

**Why?**
- HTTP input is untrusted
- Prevents accidental assumptions
- Forces validation before use

---

### 2. Validation Layer

**Responsibility:**
- Validate incoming data
- Narrow `unknown` → specific types

Example:

```ts
function isValid(input: unknown): input is SyncPullInput {
  return typeof input === 'object' && input !== null;
}
```

**Why?**
- Ensures only valid data enters core logic
- Avoids runtime bugs

---

### 3. Core Logic (Pure TypeScript)

**Responsibility:**
- Business logic only
- No HTTP, no headers, no framework concerns

Example signature:

```ts
function syncPull(input: {
  user_id: string;
  schema_version: number;
  db: DB;
}): Promise<SyncResult>
```

**Key rules:**
- Fully typed
- No `unknown`
- No `any`
- No side concerns (auth, parsing, HTTP)

**Why?**
- Predictable behavior
- Easy to test
- Reusable across environments (Edge, Node, etc.)

---

### 4. Database Layer

**Responsibility:**
- Execute queries
- Return raw data

**Reality:**
- Often loosely typed or untyped

```ts
const sql = db as any;
```

**Why this is acceptable:**
- It is a **controlled boundary**
- The rest of the system remains strictly typed
- Avoids over-engineering DB typings early

---

## Error Handling Strategy

### Core Logic

- **Throws errors** for exceptional cases
- Does NOT return HTTP-style responses

```ts
if (!SUPPORTED_SCHEMA_VERSIONS.has(schema_version)) {
  throw new Error("Unsupported schema version");
}
```

### Edge Layer

- Catches errors
- Maps to HTTP responses

```ts
try {
  const result = await syncPull(...);
  return new Response(JSON.stringify(result), { status: 200 });
} catch (err) {
  return new Response(JSON.stringify({ message: err.message }), { status: 400 });
}
```

**Why this split works:**
- Core stays framework-agnostic
- Edge handles protocol concerns (HTTP)

---

## Auth Flow

### Client

Send both:

```ts
headers: {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${access_token}`
}
```

### Edge Function

- Extract token from `Authorization`
- Verify via Supabase Auth

```ts
const { data: { user } } = await supabase.auth.getUser(token);
```

**Result:**
- `user.id` becomes `owner_id`

---

## Key Design Decisions

### 1. No Express-style abstraction

Edge functions are **not Express**.

- No middleware chain
- No req/res mutation
- Just a function: `Request → Response`

---

### 2. No "converter layer"

Avoid trying to reuse Express handlers directly.

Instead:
- Extract core logic
- Reuse logic, not framework code

---

### 3. Strict boundaries

| Layer        | Strictness |
|--------------|-----------|
| Edge         | Loose (`unknown`) |
| Validation   | Narrowing |
| Core         | Strict typing |
| DB           | Controlled `any` |

---

## Mental Model

```
[ messy world ] → unknown → validate → [ clean typed system ]
```

- External = untrusted
- Internal = controlled

---

## Common Mistake to Avoid

```ts
const data = await req.json() as MyType;
```

This is effectively:

```
unknown → lie → bug later
```

Always validate before casting.

---

## Outcome

This architecture results in:

- Clear separation of concerns
- Easier debugging
- Safer TypeScript usage
- Reusable core logic
- Minimal coupling to Supabase/Deno

---

## Final Takeaway

> Be strict where you control the data.
> Be defensive where you don’t.

This is the foundation for building reliable systems with TypeScript in serverless environments like Supabase Edge Functions.

