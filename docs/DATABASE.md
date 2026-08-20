# Datenbank – Supabase

## Rolle

Supabase ist die zentrale Datenquelle für ProblemGelöst-Inhalte und Funnel-Analytics. Website-Code gehört nicht in Supabase; Datenbank-Schemaänderungen gehören ab jetzt zusätzlich in die Git-Historie.

## Aktueller Produktionsstand (Baseline 2026-08-20)

Öffentliche Tabellen:
- `clusters`
- `problems`
- `product_types`
- `affiliate_offers`
- `problem_product_slots`
- `problem_relations`
- `analytics_events`

RLS ist auf allen öffentlichen Tabellen aktiviert.

Bereits in Production registrierte Migrationen:
1. `20260819133940_add_cluster_content_config`
2. `20260819151504_add_privacy_minimal_funnel_analytics`
3. `20260819151827_harden_funnel_analytics_insert`
4. `20260820133407_expand_21_day_funnel_analytics`

## Regel ab jetzt

Jede strukturelle DB-Änderung wird:
1. als SQL-Migration unter `supabase/migrations/` versioniert,
2. reviewed,
3. erst danach auf Supabase angewendet.

Keine spontanen Schemaänderungen ohne zugehörige Git-Migration.

## Content vs. Schema

Content-Datensätze (Probleme, Cluster, Angebote) leben in Supabase und werden nicht als Quellcode dupliziert. Das Git-Repository versioniert die Engine und das Schema, nicht den kompletten Produktions-Content.
