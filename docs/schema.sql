-- GrozeyRun Backend — Supabase Database Schema
-- Run this in the Supabase SQL Editor before deploying the backend.
-- See docs/init-requirements.md and docs/decisions/ for design rationale.

-- ---------------------------------------------------------------------------
-- User data snapshots
-- One row per authenticated user. Full-state replacement on every push sync
-- (ADR-002). owner_id is used as PK — there is exactly one snapshot per user.
-- ---------------------------------------------------------------------------

create table if not exists public.user_snapshots (
    owner_id       uuid         not null primary key references auth.users(id) on delete cascade,
    schema_version integer      not null default 1,
    items_storage  jsonb        not null default '{}',
    lists_storage  jsonb        not null default '[]',
    runs_storage   jsonb        not null default '[]',
    users_storage  jsonb,
    app_settings   jsonb,
    updated_at     timestamptz  not null default now()
);

alter table public.user_snapshots enable row level security;
alter table public.user_snapshots force row level security;

-- Wrap auth.uid() in a SELECT sub-query so it is evaluated once per statement,
-- not once per row — see security-rls-performance best practice.
create policy "user_snapshots_self_only"
    on public.user_snapshots
    for all
    to authenticated
    using ((select auth.uid()) = owner_id);

comment on table public.user_snapshots is
    'Full-state async backup snapshot of each user''s AsyncStorage data (ADR-002).';


-- ---------------------------------------------------------------------------
-- Sync audit log
-- Append-only record of every push/pull attempt for operational visibility.
-- Uses bigint identity PK (sequential, most efficient for append-heavy tables).
-- ---------------------------------------------------------------------------

create table if not exists public.sync_logs (
    id            bigint generated always as identity primary key,
    owner_id      uuid         not null references auth.users(id) on delete cascade,
    direction     text         not null check (direction in ('push', 'pull')),
    payload_size  integer,
    success       boolean      not null,
    error_message text,
    created_at    timestamptz  not null default now()
);

alter table public.sync_logs enable row level security;
alter table public.sync_logs force row level security;

-- Users may read their own log entries; only the service role (backend) writes.
create policy "sync_logs_self_read"
    on public.sync_logs
    for select
    to authenticated
    using ((select auth.uid()) = owner_id);

-- Composite index on owner_id + created_at covers the common access pattern
-- (fetch recent logs for a user) and also satisfies the RLS policy lookup.
create index if not exists sync_logs_owner_created_idx
    on public.sync_logs (owner_id, created_at desc);

comment on table public.sync_logs is
    'Audit log of every sync push/pull attempt, written by the Express backend via service role.';
