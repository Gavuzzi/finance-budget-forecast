-- ============================================================================
-- Migration: allow in-app organization creation.
-- Run once in the Supabase SQL Editor.
--
-- Lets any signed-in user INSERT a new organization. The app then creates that
-- user's membership (owner) and a default assumptions row under the existing
-- "own memberships" and "member access" policies — so a brand-new tenant can be
-- stood up entirely from the UI, no SQL.
-- ============================================================================

drop policy if exists "create org" on organizations;
create policy "create org" on organizations for insert
  with check (auth.uid() is not null);
