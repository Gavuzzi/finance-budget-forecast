#!/bin/sh
# Schema drift check: every table.column that EXISTS on the live DB must be
# mentioned in schema.sql. Catches the dangerous direction — a live change
# that wasn't mirrored into the file (the reverse direction is inherently
# noisy: schema.sql legitimately references dropped columns in its guarded
# one-time migrations, so it is not checked).
#
#   sh tools/schema-drift.sh      → OK or a list of unmirrored columns, exit 1
#
# Name-level check by design (80/20): it won't catch a type change, but it
# catches forgotten tables and forgotten "alter table add column" — the
# mistakes that actually happen.

cd "$(dirname "$0")/.." || exit 1
CLI="/c/Users/felix/supabase-bin/supabase.exe"

# The schema is split across two files: schema.sql (app tables) and
# integration-schema.sql (Fortnox tables, service-role-only). Check both.
SCHEMA_FILES="schema.sql integration-schema.sql"

live=$("$CLI" db query --linked "select table_name || '.' || column_name as c
  from information_schema.columns
  where table_schema = 'public'
  order by 1;" 2>/dev/null | grep -oE '"[a-z_]+\.[a-z_]+"' | tr -d '"')

if [ -z "$live" ]; then
  echo "DRIFT CHECK ERROR: could not read live schema (CLI down or offline)"
  exit 2
fi

missing=""
for col in $live; do
  tbl=${col%%.*}
  name=${col##*.}
  # The table must appear in a schema file, and the column name must appear
  # somewhere in the schema files too (crude but effective at name level).
  if ! grep -q "$tbl" $SCHEMA_FILES || ! grep -qhE "\b$name\b" $SCHEMA_FILES; then
    missing="$missing$col\n"
  fi
done

if [ -n "$missing" ]; then
  echo "SCHEMA DRIFT — live columns not mirrored in the schema files:"
  printf "$missing"
  exit 1
fi
count=$(echo "$live" | wc -l | tr -d ' ')
echo "DRIFT CHECK OK ($count live columns, all mirrored in the schema files)"
