-- ============================================================================
-- Accounting-integration schema (Fortnox actuals sync).
-- Run AFTER schema.sql, in Supabase Dashboard → SQL Editor. Idempotent.
--
-- Security model: OAuth tokens are secrets and live in `integrations`, which
-- has RLS on and NO policies — meaning the browser (anon/authenticated) can
-- never read it. Only Edge Functions, using the service_role key, touch it
-- (the service role bypasses RLS). The client only ever reads `integration_status`
-- (no secrets) and manages `cost_center_mappings`.
-- ============================================================================

-- --- Token store (server-only) ---------------------------------------------
create table if not exists integrations (
  org_id              uuid primary key references organizations(id) on delete cascade,
  provider            text not null default 'fortnox',
  access_token        text,                 -- ~1h lifetime
  refresh_token       text,                 -- ~45d lifetime, rotates on use
  token_expires_at    timestamptz,
  refresh_expires_at  timestamptz,
  tenant_name         text,                 -- connected Fortnox company name
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table integrations enable row level security;
-- Intentionally NO policies → only the service_role (Edge Functions) can read/write.

-- --- Connection status (client-readable, no secrets) ------------------------
create table if not exists integration_status (
  org_id            uuid primary key references organizations(id) on delete cascade,
  provider          text,
  connected         boolean not null default false,
  connected_at      timestamptz,
  last_synced_at    timestamptz,
  last_sync_error   text,
  last_reconciliation jsonb           -- the P&L from the last sync, so the app shows it on load
);
-- Idempotent catch-up for DBs created before the column existed:
alter table integration_status add column if not exists last_reconciliation jsonb;
alter table integration_status enable row level security;
drop policy if exists integration_status_read on integration_status;
create policy integration_status_read on integration_status
  for select using (is_org_member(org_id));
-- Writes are server-side (service role); no client write policy.

-- --- Cost-centre mapping (client-managed, no secrets) -----------------------
-- Maps a Fortnox cost-centre CODE (kostnadsställe) to one of our cost centers.
create table if not exists cost_center_mappings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  external_code   text not null,            -- Fortnox kostnadsställe code
  external_name   text,
  cost_center_id  uuid references cost_centers(id) on delete cascade,
  unique (org_id, external_code)
);
-- Dimension-agnostic mapping (Phase 1): a rule can match a cost-centre code,
-- a project code, or an ACCOUNT RANGE (fallback for untagged bookings).
alter table cost_center_mappings add column if not exists dimension text not null default 'costcenter'; -- costcenter|project|account
alter table cost_center_mappings add column if not exists account_from integer;
alter table cost_center_mappings add column if not exists account_to integer;
alter table cost_center_mappings enable row level security;
drop policy if exists cost_center_mappings_read  on cost_center_mappings;
drop policy if exists cost_center_mappings_write on cost_center_mappings;
create policy cost_center_mappings_read  on cost_center_mappings
  for select using (is_org_member(org_id));
create policy cost_center_mappings_write on cost_center_mappings
  for all using (can_edit_org(org_id)) with check (can_edit_org(org_id));

-- --- OAuth handshake state (CSRF binding) -----------------------------------
-- The client inserts a random `state` bound to its org before redirecting to
-- Fortnox; the callback (service role) looks it up to know which org to attach,
-- then deletes it. Random + single-use = CSRF-safe.
create table if not exists oauth_states (
  state       text primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table oauth_states enable row level security;
drop policy if exists oauth_states_write on oauth_states;
create policy oauth_states_write on oauth_states
  for insert with check (can_edit_org(org_id));
-- Server consumes (reads + deletes) via service role; no client read/delete policy.
