-- Conexões externas com APIs/ferramentas que enviam ou recebem dados do hub.
-- Fase 1 = só guarda credenciais. Validação via API real fica pra fases futuras.
-- RLS habilitada: só service-role lê/escreve (segredos no campo config).

create table connections (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('meta_ads', 'inlead', 'cademi')),
  label text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'disabled')),
  config jsonb not null default '{}'::jsonb,    -- segredos: tokens, api_keys, ids
  meta jsonb default '{}'::jsonb,                -- não-segredo: contadores, última sync
  error_message text,
  last_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index connections_kind_idx on connections(kind);
alter table connections enable row level security;

-- Webhooks de saída (hub envia pra fora). Disparo real fica pra fase futura.
create table outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null,
  events text[] not null default '{}',           -- ex: purchase.paid, subscription.cancelled
  secret text,                                   -- pra assinar HMAC ao disparar
  active boolean not null default true,
  last_fired_at timestamptz,
  last_status_code int,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table outbound_webhooks enable row level security;
