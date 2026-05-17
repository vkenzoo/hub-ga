-- Operacional: fila de jobs, logs e admin

create table pending_jobs (
  id uuid primary key default gen_random_uuid(),
  kind job_kind not null,
  payload jsonb not null,
  status job_status not null default 'queued',
  attempts int not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index pending_jobs_queue_idx on pending_jobs (status, run_after);

create table events_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  level text not null default 'info',
  payload jsonb,
  customer_id uuid,
  purchase_id uuid,
  created_at timestamptz not null default now()
);
create index events_log_created_idx on events_log (created_at desc);
create index events_log_kind_idx on events_log (kind);

create table admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);
