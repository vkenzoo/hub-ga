-- Auditoria estilo n8n executions: 1 linha por webhook HTTP recebido,
-- com payload bruto, status final e duração. events_log liga via FK.

create table webhook_executions (
  id uuid primary key default gen_random_uuid(),
  gateway gateway not null,
  raw_headers jsonb not null,
  raw_body text not null,
  body_size_bytes int not null default 0,
  client_ip text,
  user_agent text,
  raw_event_type text,
  classified_as text,
  status text not null default 'received',
  http_status int,
  duration_ms int,
  error_message text,
  customer_id uuid references customers(id),
  purchase_id uuid references purchases(id),
  gateway_event_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index webhook_executions_created_idx on webhook_executions (created_at desc);
create index webhook_executions_gateway_created_idx on webhook_executions (gateway, created_at desc);
create index webhook_executions_status_idx on webhook_executions (status);
create index webhook_executions_customer_idx on webhook_executions (customer_id) where customer_id is not null;
create index webhook_executions_dedupe_idx on webhook_executions (gateway, gateway_event_id) where gateway_event_id is not null;

alter table webhook_executions enable row level security;

-- Liga eventos de logs a uma execution
alter table events_log
  add column if not exists webhook_execution_id uuid references webhook_executions(id);
create index if not exists events_log_execution_idx on events_log(webhook_execution_id) where webhook_execution_id is not null;
