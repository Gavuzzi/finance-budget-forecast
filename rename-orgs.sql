-- ============================================================================
-- One-time rename of the already-seeded demo orgs to the anonymized names.
-- The seed in schema.sql / seed-org2.sql is guarded (it won't touch an org that
-- already exists), so renaming existing rows needs this explicit UPDATE.
-- Run in: Supabase Dashboard → SQL Editor. Safe to run once; harmless to re-run.
-- Matches by fixed UUID, so it updates 0 rows if an org isn't present.
-- ============================================================================

update organizations set name = 'Meridian Manufacturing AB'
  where id = 'a0000000-0000-0000-0000-000000000001';

update organizations set name = 'Vantage Consulting AB'
  where id = 'a0000000-0000-0000-0000-000000000002';
