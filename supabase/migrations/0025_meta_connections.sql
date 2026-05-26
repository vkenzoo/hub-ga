-- Conexões Meta Marketing API (Caminho B — System User Token, sem App Review).
-- Cada BM tem 1 row. Suporta múltiplos BMs (multi-BM).
-- Auth: service-role only (admin-only via app layer, sem RLS por user).

create table if not exists meta_connections (
  id                          uuid primary key default gen_random_uuid(),
  business_manager_id         text not null,
  business_manager_name       text,
  app_id                      text not null,
  -- AES-256-GCM ciphertexts (base64). Nunca em plaintext.
  app_secret_ciphertext       text not null,
  access_token_ciphertext     text not null,
  granted_scopes              text[] not null default '{}',
  fb_user_id                  text not null,
  fb_user_name                text,
  expires_at                  timestamptz,                -- NULL = vitalício (System User)
  status                      text not null default 'active'
                              check (status in ('active','invalid','revoked')),
  connection_type             text not null default 'system_user',
  last_synced_at              timestamptz,
  last_healthcheck_at         timestamptz,
  last_error                  text,                       -- mensagem do último erro de sync/healthcheck
  created_by_email            text,                       -- audit (quem conectou)
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (business_manager_id)
);

create index if not exists meta_connections_status_idx
  on meta_connections(status) where status = 'active';

alter table meta_connections enable row level security;
-- Sem policy: só service-role acessa (admin-only via app).

-- Ad Accounts descobertas via /{bm_id}/owned_ad_accounts + /client_ad_accounts.
-- Cache local pra UI rápida sem hit constante na Graph.
create table if not exists ad_accounts (
  id                          uuid primary key default gen_random_uuid(),
  meta_connection_id          uuid not null references meta_connections(id) on delete cascade,
  account_id                  text not null,             -- 'act_xxxxx'
  name                        text,
  currency                    text,
  timezone_name               text,
  account_status              int,                       -- 1=active, 2=disabled, etc
  balance_cents               bigint,
  amount_spent_cents          bigint,
  last_synced_at              timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (meta_connection_id, account_id)
);

create index if not exists ad_accounts_connection_idx
  on ad_accounts(meta_connection_id);

alter table ad_accounts enable row level security;

-- Trigger pra atualizar updated_at em ambas (padrão da app).
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists meta_connections_updated_at on meta_connections;
create trigger meta_connections_updated_at
  before update on meta_connections
  for each row execute function set_updated_at();

drop trigger if exists ad_accounts_updated_at on ad_accounts;
create trigger ad_accounts_updated_at
  before update on ad_accounts
  for each row execute function set_updated_at();
