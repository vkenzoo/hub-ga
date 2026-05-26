-- Spend diário per-ad da Marketing API. Cada row = 1 ad em 1 dia.
-- Permite agregação por campanha/adset/ad e classificação por campaign_rules.

create table if not exists meta_ad_insights_daily (
  id                  uuid primary key default gen_random_uuid(),
  ad_account_id       uuid not null references ad_accounts(id) on delete cascade,
  date_start          date not null,                  -- dia em fuso da conta
  campaign_id         text not null,
  campaign_name       text,
  adset_id            text,
  adset_name          text,
  ad_id               text not null,
  ad_name             text,
  -- Métricas (cents pra evitar float drift)
  spend_cents         bigint not null default 0,
  impressions         bigint not null default 0,
  clicks              bigint not null default 0,
  reach               bigint,
  -- Classificação derivada de campaign_rules (acquisition / monetization / other / null)
  classification      text check (classification in ('acquisition','monetization','other')),
  last_synced_at      timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (ad_id, date_start)
);

-- Index pra agregação por período + filtros comuns
create index if not exists meta_insights_date_idx
  on meta_ad_insights_daily(date_start desc);
create index if not exists meta_insights_account_date_idx
  on meta_ad_insights_daily(ad_account_id, date_start desc);
create index if not exists meta_insights_classification_idx
  on meta_ad_insights_daily(classification, date_start desc)
  where classification is not null;
create index if not exists meta_insights_campaign_idx
  on meta_ad_insights_daily(campaign_id, date_start desc);

alter table meta_ad_insights_daily enable row level security;
