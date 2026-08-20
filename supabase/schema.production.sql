-- ProblemGelöst production schema baseline
-- Snapshot date: 2026-08-20
--
-- Purpose:
--   Version-controlled snapshot of the current production database schema.
--   This file is a recovery/reference baseline, NOT a migration to run against
--   the existing production database.
--
-- Going forward:
--   Every schema change must be added as a new SQL file under supabase/migrations/.
--
-- Current Supabase migration history at baseline:
--   20260819133940 add_cluster_content_config
--   20260819151504 add_privacy_minimal_funnel_analytics
--   20260819151827 harden_funnel_analytics_insert
--   20260820133407 expand_21_day_funnel_analytics

create table public.clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  status text not null default 'active'
    check (status = any (array['draft'::text, 'active'::text, 'archived'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seo_title text,
  meta_description text,
  featured_problem_slugs jsonb not null default '[]'::jsonb,
  entry_points jsonb not null default '[]'::jsonb
);

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters(id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'draft'
    check (status = any (array['draft'::text, 'review'::text, 'published'::text, 'archived'::text])),
  schema_version integer not null default 1 check (schema_version > 0),
  main_keyword text not null,
  search_intent text not null default 'problem_solution',
  user_question text,
  keywords jsonb not null default '[]'::jsonb,
  diagnostic_flow jsonb not null default '{}'::jsonb,
  solution_paths jsonb not null default '[]'::jsonb,
  seo_title text,
  meta_description text,
  h1 text,
  faq jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (cluster_id, slug)
);

create table public.product_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  status text not null default 'active'
    check (status = any (array['active'::text, 'inactive'::text, 'archived'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.affiliate_offers (
  id uuid primary key default gen_random_uuid(),
  product_type_id uuid not null references public.product_types(id) on delete cascade,
  provider text not null,
  product_name text not null,
  affiliate_url text not null,
  tracking_id text,
  image_url text,
  price numeric,
  currency text default 'EUR',
  priority integer not null default 100,
  status text not null default 'active'
    check (status = any (array['active'::text, 'inactive'::text, 'archived'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.problem_product_slots (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  solution_path_id text,
  slot text not null
    check (slot = any (array['cheap'::text, 'recommended'::text, 'premium'::text])),
  product_type_id uuid not null references public.product_types(id) on delete restrict,
  cta text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (problem_id, solution_path_id, slot, product_type_id)
);

create table public.problem_relations (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  related_problem_id uuid not null references public.problems(id) on delete cascade,
  relation_type text not null default 'related',
  weight integer not null default 50 check (weight >= 0 and weight <= 100),
  created_at timestamptz not null default now(),
  check (problem_id <> related_problem_id),
  unique (problem_id, related_problem_id, relation_type)
);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null
    check (event_name = any (array[
      'page_view'::text,
      'diagnosis_start'::text,
      'diagnosis_complete'::text,
      'product_click'::text,
      'finder_started'::text,
      'answer_selected'::text,
      'solution_reached'::text,
      'free_solution_clicked'::text,
      'product_solution_clicked'::text,
      'feedback_yes'::text,
      'feedback_no'::text
    ])),
  pathname text not null,
  cluster_slug text,
  problem_slug text,
  solution_path_id text,
  product_type_slug text,
  referrer_host text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  session_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text
);

-- Non-constraint indexes
create index idx_affiliate_offers_product_type
  on public.affiliate_offers using btree (product_type_id);

create index idx_affiliate_offers_status_priority
  on public.affiliate_offers using btree (status, priority);

create index analytics_events_created_at_idx
  on public.analytics_events using btree (created_at desc);

create index analytics_events_event_created_idx
  on public.analytics_events using btree (event_name, created_at desc);

create index analytics_events_event_name_idx
  on public.analytics_events using btree (event_name);

create index analytics_events_problem_slug_idx
  on public.analytics_events using btree (problem_slug);

create index analytics_events_session_created_idx
  on public.analytics_events using btree (session_id, created_at desc);

create index analytics_events_source_created_idx
  on public.analytics_events using btree (utm_source, created_at desc);

create index idx_problem_product_slots_problem
  on public.problem_product_slots using btree (problem_id);

create index idx_problem_relations_problem
  on public.problem_relations using btree (problem_id);

create index idx_problems_cluster_id
  on public.problems using btree (cluster_id);

create index idx_problems_status
  on public.problems using btree (status);

-- Row Level Security
alter table public.clusters enable row level security;
alter table public.problems enable row level security;
alter table public.product_types enable row level security;
alter table public.affiliate_offers enable row level security;
alter table public.problem_product_slots enable row level security;
alter table public.problem_relations enable row level security;
alter table public.analytics_events enable row level security;

create policy "public read active clusters"
on public.clusters
for select
to anon, authenticated
using (status = 'active'::text);

create policy "public read published problems"
on public.problems
for select
to anon, authenticated
using (status = 'published'::text);

create policy "public read active product types"
on public.product_types
for select
to anon, authenticated
using (status = 'active'::text);

create policy "public read active affiliate offers"
on public.affiliate_offers
for select
to anon, authenticated
using (status = 'active'::text);

create policy "public read slots for published problems"
on public.problem_product_slots
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.problems p
    where p.id = problem_product_slots.problem_id
      and p.status = 'published'::text
  )
);

create policy "public read relations for published problems"
on public.problem_relations
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.problems p1
    join public.problems p2
      on p2.id = problem_relations.related_problem_id
    where p1.id = problem_relations.problem_id
      and p1.status = 'published'::text
      and p2.status = 'published'::text
  )
);

create policy "public can insert sanitized analytics events"
on public.analytics_events
for insert
to anon, authenticated
with check (
  event_name = any (array[
    'page_view'::text,
    'diagnosis_start'::text,
    'diagnosis_complete'::text,
    'product_click'::text,
    'finder_started'::text,
    'answer_selected'::text,
    'solution_reached'::text,
    'free_solution_clicked'::text,
    'product_solution_clicked'::text,
    'feedback_yes'::text,
    'feedback_no'::text
  ])
  and char_length(pathname) between 1 and 500
  and session_id is not null
  and char_length(session_id) between 1 and 80
  and (cluster_slug is null or char_length(cluster_slug) <= 120)
  and (problem_slug is null or char_length(problem_slug) <= 180)
  and (solution_path_id is null or char_length(solution_path_id) <= 180)
  and (product_type_slug is null or char_length(product_type_slug) <= 180)
  and (referrer_host is null or char_length(referrer_host) <= 255)
  and (utm_source is null or char_length(utm_source) <= 100)
  and (utm_medium is null or char_length(utm_medium) <= 100)
  and (utm_campaign is null or char_length(utm_campaign) <= 150)
  and (utm_content is null or char_length(utm_content) <= 150)
  and octet_length(meta::text) <= 4000
);

-- Public API privileges: least privilege
revoke all on table public.clusters from anon, authenticated;
revoke all on table public.problems from anon, authenticated;
revoke all on table public.product_types from anon, authenticated;
revoke all on table public.affiliate_offers from anon, authenticated;
revoke all on table public.problem_product_slots from anon, authenticated;
revoke all on table public.problem_relations from anon, authenticated;
revoke all on table public.analytics_events from anon, authenticated;

grant select on table
  public.clusters,
  public.problems,
  public.product_types,
  public.affiliate_offers,
  public.problem_product_slots,
  public.problem_relations
to anon, authenticated;

grant insert on table public.analytics_events to anon, authenticated;
