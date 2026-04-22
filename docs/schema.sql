-- GrozeyRun Backend — Supabase Database Schema
-- Run this in the Supabase SQL Editor.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--
-- Source of truth: grozerun-mobile/docs/schema.md
-- Supabase additions: auth.users FK, nullable password_hash, RLS, indexes.
--
-- list_shares_storage is an optional key in the sync payload. When present,
-- shares are re-inserted after lists. When absent, cascade-delete on lists
-- clears all shares for that user (acceptable — no shares means no shares).

-- ===========================================================================
-- Enums
-- ===========================================================================

DO $$ BEGIN
    CREATE TYPE period_type AS ENUM ('weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE theme_type AS ENUM ('light', 'dark');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE permission_type AS ENUM ('view', 'edit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE sync_type AS ENUM ('pull', 'push');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Users
-- Stores the public user profile. id must match auth.users.id.
-- password_hash is intentionally nullable: Supabase Auth owns credentials.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id            UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at    TIMESTAMP    DEFAULT NOW(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    first_name    VARCHAR(100),
    last_name     VARCHAR(100),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- auth.uid() wrapped in SELECT so it is evaluated once per statement, not per row
DO $$ BEGIN
    CREATE POLICY "users_self_only"
        ON public.users FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- App Settings
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
    user_id       UUID          PRIMARY KEY,
    budget        NUMERIC(10,2),
    currency      VARCHAR(10),
    max_hours     NUMERIC(6,2),
    notifications BOOLEAN       DEFAULT TRUE,
    period        period_type   DEFAULT 'monthly',
    theme         theme_type    DEFAULT 'light',
    updated_at    TIMESTAMP     DEFAULT NOW(),
    CONSTRAINT fk_settings_user
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "app_settings_self_only"
        ON public.app_settings FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grocery Lists
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.lists (
    id          UUID         PRIMARY KEY,
    created_at  TIMESTAMP    DEFAULT NOW(),
    description VARCHAR(500),
    is_shared   BOOLEAN      DEFAULT FALSE,
    item_count  INTEGER      DEFAULT 0,
    name        VARCHAR(100) NOT NULL,
    owner_id    UUID         NOT NULL,
    total_cost  NUMERIC(10,2) DEFAULT 0,
    updated_at  TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT fk_lists_owner
        FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "lists_self_only"
        ON public.lists FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS lists_owner_id_idx ON public.lists (owner_id);

-- ===========================================================================
-- Grocery List Shares
-- Included in list_shares_storage in the sync payload (optional key).
-- On push: cascade-deleted with lists, then re-inserted from list_shares_storage.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.list_shares (
    id              UUID            PRIMARY KEY,
    grocery_list_id UUID            NOT NULL,
    invited_at      TIMESTAMP       DEFAULT NOW(),
    permission      permission_type NOT NULL,
    user_id         UUID            NOT NULL,
    CONSTRAINT fk_shares_list
        FOREIGN KEY (grocery_list_id) REFERENCES public.lists(id) ON DELETE CASCADE,
    CONSTRAINT fk_shares_user
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT uq_list_user UNIQUE (grocery_list_id, user_id)
);

ALTER TABLE public.list_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_shares FORCE ROW LEVEL SECURITY;

-- Users may see shares for lists they own OR shares that involve them
DO $$ BEGIN
    CREATE POLICY "list_shares_access"
        ON public.list_shares FOR ALL TO authenticated
        USING (
            (SELECT auth.uid()) = user_id
            OR (SELECT auth.uid()) IN (
                SELECT owner_id FROM public.lists WHERE id = grocery_list_id
            )
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS list_shares_list_id_idx    ON public.list_shares (grocery_list_id);
CREATE INDEX IF NOT EXISTS list_shares_user_id_idx    ON public.list_shares (user_id);

-- ===========================================================================
-- Grocery Items
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.items (
    id          UUID          PRIMARY KEY,
    category    VARCHAR(50),
    completed   BOOLEAN       DEFAULT FALSE,
    created_at  TIMESTAMP     DEFAULT NOW(),
    currency    VARCHAR(10),
    description VARCHAR(300),
    list_id     UUID          NOT NULL,
    notes       VARCHAR(300),
    owner_id    UUID          NOT NULL,
    quantity    INTEGER,
    text        VARCHAR(100)  NOT NULL,
    unit        VARCHAR(20),
    unit_price  NUMERIC(10,2),
    updated_at  TIMESTAMP     DEFAULT NOW(),
    CONSTRAINT fk_items_list
        FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_owner
        FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "items_self_only"
        ON public.items FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS items_owner_id_idx ON public.items (owner_id);
CREATE INDEX IF NOT EXISTS items_list_id_idx  ON public.items (list_id);

-- ===========================================================================
-- Shopping Runs
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.runs (
    id              UUID          PRIMARY KEY,
    completion_date TIMESTAMP,
    created_at      TIMESTAMP     DEFAULT NOW(),
    description     VARCHAR(500),
    is_completed    BOOLEAN       DEFAULT FALSE,
    list_id         UUID          NOT NULL,
    name            VARCHAR(100),
    owner_id        UUID          NOT NULL,
    total_time      NUMERIC(6,2),
    updated_at      TIMESTAMP     DEFAULT NOW(),
    CONSTRAINT fk_runs_list
        FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE,
    CONSTRAINT fk_runs_owner
        FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "runs_self_only"
        ON public.runs FOR ALL TO authenticated
        USING ((SELECT auth.uid()) = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS runs_owner_id_idx ON public.runs (owner_id);
CREATE INDEX IF NOT EXISTS runs_list_id_idx  ON public.runs (list_id);

-- ===========================================================================
-- Sync Log
-- Append-only audit trail of every push/pull attempt.
-- Written by the Express backend using the service role key.
-- Users may read their own log entries via RLS.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.sync_logs (
    id             UUID         PRIMARY KEY,
    data_size      INTEGER,
    message        VARCHAR(255),
    schema_version VARCHAR(10),
    success        BOOLEAN,
    sync_time      TIMESTAMP    DEFAULT NOW(),
    sync_type      sync_type,
    user_id        UUID         NOT NULL,
    CONSTRAINT fk_sync_user
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "sync_logs_self_read"
        ON public.sync_logs FOR SELECT TO authenticated
        USING ((SELECT auth.uid()) = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Composite index covers "show me my recent sync history" queries
CREATE INDEX IF NOT EXISTS sync_logs_user_time_idx ON public.sync_logs (user_id, sync_time DESC);

