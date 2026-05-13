-- Supabase schema (Phase 1)

create extension if not exists pgcrypto;

create table if not exists jobs (
  id text primary key,
  job_name text not null,
  address text not null,
  measure_date text not null,
  measured_by text,
  on_site_contact text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists openings (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_openings_job_id on openings(job_id);
create index if not exists idx_jobs_updated_at on jobs(updated_at desc);

-- Optional audit
create table if not exists sync_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity text not null,
  entity_id text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
