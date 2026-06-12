-- Entregas de saída (hub → plataforma externa, ex: GoHighLevel).
--
-- Funciona como FILA + LOG ao mesmo tempo:
--   - O route do Respondi, ao receber resposta de form de APLICAÇÃO, insere 1 row
--     status='pending' por destino configurado (outbound_webhooks subscrito ao
--     evento 'survey.application').
--   - O cron /api/cron/process-jobs drena as pending: faz POST, grava status +
--     http_status + response_body. Falha → retry com backoff (run_after).
--
-- Não usa pending_jobs (cujo enum job_kind não tem valor pra isso) — self-contained
-- e já serve de fonte pro monitoramento de posts no admin.

create table if not exists outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  destination text not null,                 -- label do webhook (ex: "GoHighLevel")
  event text not null,                       -- ex: "survey.application"
  source_ref text,                           -- id da survey_response que originou
  url text not null,                         -- destino do POST
  payload jsonb not null,                    -- corpo enviado
  status text not null default 'pending' check (status in ('pending','success','failed')),
  http_status int,                           -- código de resposta do destino
  response_body text,                        -- corpo da resposta (truncado)
  attempts int not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists outbound_deliveries_queue_idx
  on outbound_deliveries (status, run_after) where status = 'pending';
create index if not exists outbound_deliveries_created_idx
  on outbound_deliveries (created_at desc);
create index if not exists outbound_deliveries_source_idx
  on outbound_deliveries (source_ref) where source_ref is not null;

alter table outbound_deliveries enable row level security;
-- Sem policy: só service-role (createSupabaseAdmin / createHubServiceClient).
