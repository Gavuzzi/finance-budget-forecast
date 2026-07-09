-- ============================================================================
-- FP&A Base — complete database setup (multi-tenant, RLS from day one).
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run.
--
-- This is the SINGLE source of truth: fully idempotent, so you can run it on a
-- fresh database OR re-run it on an existing one to bring it current — tables
-- use IF NOT EXISTS, columns use ADD COLUMN IF NOT EXISTS, policies are dropped
-- and recreated, and the seed is guarded so it only inserts once.
-- (Replaces the old separate migration-*.sql files.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- Every business table carries org_id. A row belongs to exactly one tenant.
-- ---------------------------------------------------------------------------

create table if not exists organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  close_month       smallint not null default 6,   -- actuals booked through this absolute month (1..24 timeline)
  currency          text not null default 'SEK',
  created_at        timestamptz not null default now()
);

-- Links an auth user to an org with a role. This table IS the multi-tenant boundary.
create table if not exists memberships (
  user_id           uuid not null references auth.users(id) on delete cascade,
  org_id            uuid not null references organizations(id) on delete cascade,
  role              text not null default 'editor',   -- owner | editor | viewer
  created_at        timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- Per-tenant rate assumptions (one row per org). Feeds the rate engine.
create table if not exists assumptions (
  org_id                      uuid primary key references organizations(id) on delete cascade,
  employer_contribution_pct   numeric not null default 31.42,
  equipment_monthly           numeric not null default 1200,
  other_overhead_pct          numeric not null default 4
);

-- Per-tenant role salary catalog. Loaded cost is DERIVED in app code from base_salary + assumptions.
create table if not exists roles (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  label             text not null,
  base_salary       numeric not null default 0
);

create table if not exists cost_centers (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  annual_budget     numeric not null default 0,
  other_monthly     numeric not null default 0,  -- catch-all monthly run-rate (materials, utilities, etc.)
  note              text                          -- variance commentary shown on the Overview + board PDF
);

-- A headcount line on the absolute month timeline (hires/leavers/contracts start & stop).
create table if not exists headcount_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  cost_center_id    uuid not null references cost_centers(id) on delete cascade,
  role_id           uuid not null references roles(id) on delete restrict,
  count             integer not null default 1,    -- negative = leaver
  start_month       smallint not null,
  end_month         smallint not null
);

create table if not exists one_offs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  cost_center_id    uuid not null references cost_centers(id) on delete cascade,
  label             text not null,
  amount            numeric not null default 0,
  month             smallint not null
);

-- Booked actuals per cost center per absolute month (later fed by the ERP import).
create table if not exists monthly_actual (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  cost_center_id    uuid not null references cost_centers(id) on delete cascade,
  month             smallint not null,
  amount            numeric not null default 0,
  unique (cost_center_id, month)
);

-- What-if scenario snapshots: name + full-year total + per-cost-center breakdown.
create table if not exists scenarios (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  fy_total          numeric not null,
  snapshot          jsonb,
  created_at        timestamptz not null default now()
);

-- A locked, approved budget baseline: a snapshot of every cost centre's
-- annual_budget at lock time, so "variance vs budget" can mean "vs what was
-- approved" even after the live budget keeps getting edited.
create table if not exists budget_versions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  locked_at         timestamptz not null default now(),
  snapshot          jsonb not null,   -- { cost_center_id: annual_budget }
  total             numeric not null default 0
);
alter table budget_versions enable row level security;
drop policy if exists budget_versions_read on budget_versions;
drop policy if exists budget_versions_write on budget_versions;
create policy budget_versions_read on budget_versions for select using (is_org_member(org_id));
create policy budget_versions_write on budget_versions for all using (can_edit_org(org_id)) with check (can_edit_org(org_id));

-- Recurring costs: named lines with a start/end month + optional annual
-- escalation — replaces the old flat "other_monthly" blob (kept as a legacy
-- column, no longer read by the engine) so run-rate costs (rent, subs, leases)
-- can start/stop and grow over time instead of being one flat number forever.
create table if not exists recurring_costs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  cost_center_id uuid not null references cost_centers(id) on delete cascade,
  label          text not null default 'Other costs',
  amount         numeric not null default 0,
  start_month    smallint not null default 1,
  end_month      smallint not null default 24,
  escalation_pct numeric not null default 0
);
alter table recurring_costs enable row level security;
drop policy if exists recurring_costs_read on recurring_costs;
drop policy if exists recurring_costs_write on recurring_costs;
create policy recurring_costs_read on recurring_costs for select using (is_org_member(org_id));
create policy recurring_costs_write on recurring_costs for all using (can_edit_org(org_id)) with check (can_edit_org(org_id));

-- One-time backward-compat migration: preserve every cost centre's existing
-- other_monthly as an equivalent recurring-cost row (idempotent — only inserts
-- where one doesn't already exist for that cost centre).
insert into recurring_costs (org_id, cost_center_id, label, amount, start_month, end_month, escalation_pct)
select cc.org_id, cc.id, 'Other costs (migrated)', cc.other_monthly, 1, 24, 0
from cost_centers cc
where cc.other_monthly > 0
and not exists (select 1 from recurring_costs rc where rc.cost_center_id = cc.id);

-- Idempotent catch-up for databases created before newer columns existed.
alter table cost_centers add column if not exists note text;
alter table organizations add column if not exists fy_start_month smallint not null default 1;  -- broken fiscal years (May–Apr etc.)
alter table organizations add column if not exists fy_start_year  smallint not null default 2026;
alter table organizations add column if not exists close_month_manual boolean not null default false; -- user override of "booked through"
alter table cost_centers add column if not exists source text not null default 'manual';  -- fortnox|manual (fortnox-sourced lines refresh on sync)
alter table cost_centers add column if not exists state  text not null default 'linked';  -- planned|linked (plan-ahead lifecycle)
alter table assumptions add column if not exists revenue_budget numeric not null default 0; -- simple annual revenue target — no driver engine, just a number to compare actuals against

-- ---------------------------------------------------------------------------
-- Row-Level Security: a user can touch a row only if they're a member of its org.
-- Enabled on EVERY table. The anon key is safe in the browser only because of this.
-- ---------------------------------------------------------------------------

alter table organizations   enable row level security;
alter table memberships     enable row level security;
alter table assumptions     enable row level security;
alter table roles           enable row level security;
alter table cost_centers    enable row level security;
alter table headcount_lines enable row level security;
alter table one_offs        enable row level security;
alter table monthly_actual  enable row level security;
alter table scenarios       enable row level security;

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read memberships without
-- tripping RLS recursion — they only ever check the CURRENT user's own row.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
  returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.can_edit_org(p_org uuid)
  returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid() and role in ('owner', 'editor')
  );
$$;

-- The ONLY way to create an org + membership: atomic, and it stops a client from
-- inserting a membership directly (which would let anyone join any org they know
-- the id of). Called from the app via sb.rpc('create_organization', {...}).
create or replace function public.create_organization(org_name text)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into organizations (name) values (org_name) returning id into v_org;
  insert into memberships (user_id, org_id, role) values (auth.uid(), v_org, 'owner');
  insert into assumptions (org_id) values (v_org);
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policies. Reads: any member. Writes: owner/editor only (viewers are read-only).
-- Memberships can ONLY be created by create_organization() above — never by a
-- client insert — which closes the "add myself to any org" hole.
-- ---------------------------------------------------------------------------

-- Memberships: read + leave your own; no direct insert/update by clients.
drop policy if exists "own memberships"        on memberships;
drop policy if exists "read own memberships"   on memberships;
drop policy if exists "leave org"              on memberships;
create policy "read own memberships" on memberships for select using (user_id = auth.uid());
create policy "leave org"            on memberships for delete using (user_id = auth.uid());

-- Organizations: members read; editors rename / advance the period. Insert is via
-- create_organization() only; no client delete.
drop policy if exists "org member access" on organizations;
drop policy if exists "create org"        on organizations;
drop policy if exists "org read"          on organizations;
drop policy if exists "org edit"          on organizations;
create policy "org read" on organizations for select using (is_org_member(id));
create policy "org edit" on organizations for update using (can_edit_org(id)) with check (can_edit_org(id));

-- Every data table: read = member, write = editor. Two policies each (OR'd),
-- generated in a loop so they stay identical and there's no place to slip a hole.
do $$
declare t text;
begin
  foreach t in array array['assumptions','roles','cost_centers','headcount_lines','one_offs','monthly_actual','scenarios']
  loop
    execute format('drop policy if exists "member access" on %I', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for select using (is_org_member(org_id))', t || '_read', t);
    execute format('create policy %I on %I for all using (can_edit_org(org_id)) with check (can_edit_org(org_id))', t || '_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: one tenant ("Meridian Manufacturing AB") ported from the demo fixtures.
-- Guarded so re-running the whole file won't duplicate it.
-- The SQL editor runs as an admin role, so this bypasses RLS (expected).
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  r_prodop  uuid := 'b0000000-0000-0000-0000-000000000001';
  r_shift   uuid := 'b0000000-0000-0000-0000-000000000002';
  r_acct    uuid := 'b0000000-0000-0000-0000-000000000003';
  r_mkt     uuid := 'b0000000-0000-0000-0000-000000000004';
  r_eng     uuid := 'b0000000-0000-0000-0000-000000000005';
  r_intern  uuid := 'b0000000-0000-0000-0000-000000000006';
  r_admin   uuid := 'b0000000-0000-0000-0000-000000000007';
  r_it      uuid := 'b0000000-0000-0000-0000-000000000008';
  r_devops  uuid := 'b0000000-0000-0000-0000-000000000009';
  c_prod    uuid := 'c0000000-0000-0000-0000-000000000001';
  c_sales   uuid := 'c0000000-0000-0000-0000-000000000002';
  c_rnd     uuid := 'c0000000-0000-0000-0000-000000000003';
  c_admin   uuid := 'c0000000-0000-0000-0000-000000000004';
  c_it      uuid := 'c0000000-0000-0000-0000-000000000005';
begin
  if exists (select 1 from organizations where id = v_org) then
    return; -- already seeded
  end if;

  insert into organizations (id, name, close_month, currency)
    values (v_org, 'Meridian Manufacturing AB', 6, 'SEK');

  insert into assumptions (org_id, employer_contribution_pct, equipment_monthly, other_overhead_pct)
    values (v_org, 31.42, 1200, 4);

  insert into roles (id, org_id, label, base_salary) values
    (r_prodop, v_org, 'Production Operator', 33000),
    (r_shift,  v_org, 'Shift Supervisor', 42000),
    (r_acct,   v_org, 'Account Manager', 39000),
    (r_mkt,    v_org, 'Marketing Coordinator', 29000),
    (r_eng,    v_org, 'Engineer', 47000),
    (r_intern, v_org, 'Research Intern', 21000),
    (r_admin,  v_org, 'Admin & Finance Staff', 33000),
    (r_it,     v_org, 'IT Support Specialist', 36000),
    (r_devops, v_org, 'Cloud/DevOps Contractor', 48000);

  insert into cost_centers (id, org_id, name, annual_budget, other_monthly) values
    (c_prod,  v_org, 'Production', 28000000, 1350000),
    (c_sales, v_org, 'Sales & Marketing', 12000000, 583000),
    (c_rnd,   v_org, 'R&D', 9000000, 283000),
    (c_admin, v_org, 'Administration', 6000000, 250000),
    (c_it,    v_org, 'IT', 5000000, 166000);

  insert into headcount_lines (org_id, cost_center_id, role_id, count, start_month, end_month) values
    (v_org, c_prod,  r_prodop, 18, 1, 24),
    (v_org, c_prod,  r_shift,   1, 9, 24),
    (v_org, c_sales, r_acct,    5, 1, 24),
    (v_org, c_sales, r_mkt,     1, 8, 24),
    (v_org, c_rnd,   r_eng,     6, 1, 24),
    (v_org, c_rnd,   r_intern,  1, 9, 12),
    (v_org, c_admin, r_admin,   4, 1, 24),
    (v_org, c_it,    r_it,      2, 1, 24),
    (v_org, c_it,    r_devops,  1, 10, 12);

  insert into one_offs (org_id, cost_center_id, label, amount, month) values
    (v_org, c_prod,  'Press line maintenance overhaul', 650000, 9),
    (v_org, c_sales, 'Autumn trade-fair campaign', 480000, 10),
    (v_org, c_rnd,   'Prototype tooling', 320000, 8),
    (v_org, c_admin, 'Office renovation', 150000, 11),
    (v_org, c_it,    'Laptop refresh batch', 180000, 8);

  insert into monthly_actual (org_id, cost_center_id, month, amount) values
    (v_org, c_prod, 1,2380000),(v_org, c_prod, 2,2410000),(v_org, c_prod, 3,2510000),
    (v_org, c_prod, 4,2440000),(v_org, c_prod, 5,2460000),(v_org, c_prod, 6,2400000),
    (v_org, c_prod, 7,2250000),(v_org, c_prod, 8,2150000),(v_org, c_prod, 9,2950000),
    (v_org, c_sales,1,1080000),(v_org, c_sales,2,1100000),(v_org, c_sales,3,1200000),
    (v_org, c_sales,4,1120000),(v_org, c_sales,5,1150000),(v_org, c_sales,6,1150000),
    (v_org, c_sales,7, 880000),(v_org, c_sales,8, 870000),(v_org, c_sales,9, 930000),
    (v_org, c_rnd,  1, 780000),(v_org, c_rnd,  2, 800000),(v_org, c_rnd,  3, 850000),
    (v_org, c_rnd,  4, 820000),(v_org, c_rnd,  5, 830000),(v_org, c_rnd,  6, 820000),
    (v_org, c_rnd,  7, 700000),(v_org, c_rnd,  8, 970000),(v_org, c_rnd,  9, 730000),
    (v_org, c_admin,1, 480000),(v_org, c_admin,2, 500000),(v_org, c_admin,3, 540000),
    (v_org, c_admin,4, 510000),(v_org, c_admin,5, 520000),(v_org, c_admin,6, 500000),
    (v_org, c_admin,7, 430000),(v_org, c_admin,8, 445000),(v_org, c_admin,9, 438000),
    (v_org, c_it,   1, 360000),(v_org, c_it,   2, 370000),(v_org, c_it,   3, 400000),
    (v_org, c_it,   4, 390000),(v_org, c_it,   5, 400000),(v_org, c_it,   6, 380000),
    (v_org, c_it,   7, 270000),(v_org, c_it,   8, 440000),(v_org, c_it,   9, 275000);
end $$;

-- ---------------------------------------------------------------------------
-- AFTER you create your login (Phase 2: sign up through the app, OR add a user
-- in Dashboard → Authentication → Users), run this once to make yourself an
-- owner of the seeded org so RLS lets you see its data:
--
--   insert into memberships (user_id, org_id, role)
--   select id, 'a0000000-0000-0000-0000-000000000001', 'owner'
--   from auth.users where email = 'felixroos@gmail.com'
--   on conflict do nothing;
-- ---------------------------------------------------------------------------
