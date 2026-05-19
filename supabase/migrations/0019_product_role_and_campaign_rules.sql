-- Classificação de produtos e regras de match em campanhas de Meta Ads.
-- Permite separar receita de aquisição vs monetização nos dashboards.
--
-- Lógica do dashboard de aquisição:
--   * Receita: só compras de produtos com role='acquisition'
--   * Investimento (futuro): só campanhas que casam em alguma regra com classification='acquisition'

create type product_role as enum ('acquisition', 'monetization', 'other');

alter table products
  add column if not exists role product_role not null default 'other';

create index if not exists products_role_idx on products(role);

-- Backfill: produtos existentes viram 'acquisition' por padrão pra preservar comportamento atual
update products set role = 'acquisition' where role = 'other';

-- Regras pra classificar campanhas Meta Ads pelo nome.
-- Quando múltiplas regras casam, vence a de menor priority. Default 100.
create table campaign_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  match_type text not null default 'contains' check (match_type in ('contains', 'equals', 'starts_with', 'regex')),
  classification product_role not null,
  priority int not null default 100,
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaign_rules_active_idx on campaign_rules(active, priority) where active = true;

alter table campaign_rules enable row level security;
