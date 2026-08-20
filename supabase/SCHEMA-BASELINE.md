# Supabase schema baseline

`schema.production.sql` is a version-controlled snapshot of the production schema as of 2026-08-20.

It is **not** meant to be executed against the existing production database. Production already contains the schema and has its own Supabase migration history.

From this baseline onward:
- every structural database change gets a new SQL migration in `supabase/migrations/`
- migrations are committed in the same Git change as the code that depends on them
- production data itself is not stored in Git
- secrets are never stored in this repository

Baseline migration history already present in production:
- 20260819133940 `add_cluster_content_config`
- 20260819151504 `add_privacy_minimal_funnel_analytics`
- 20260819151827 `harden_funnel_analytics_insert`
- 20260820133407 `expand_21_day_funnel_analytics`
