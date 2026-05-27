-- Atribuição UTM purchase → campaign/adset/ad via Marketing API IDs.
-- 1 row por purchase. Disparada fire-and-forget no webhook handler após cada
-- purchase_paid. Refunds/chargebacks marcam is_active=false (não deleta).

create table if not exists utm_sales_attribution (
  id                       uuid primary key default gen_random_uuid(),
  purchase_id              uuid not null unique references purchases(id) on delete cascade,
  matched                  boolean not null default false,
  match_method             text,
  -- Confiança: 1.00 utm_id/utm_term_ad_id, 0.90 triple_utm, 0.70 campaign_only,
  -- 0.40 fuzzy_campaign_name, 0.00 direct
  match_confidence         numeric(3,2),
  -- Meta IDs (strings — não FK porque ads/campaigns não existem como tabelas separadas)
  campaign_id              text,
  campaign_name            text,
  adset_id                 text,
  ad_id                    text,
  -- Estado pra refund/chargeback (toggle, nunca deleta)
  is_active                boolean not null default true,
  inactive_reason          text,
  attributed_at            timestamptz not null default now(),
  inactive_at              timestamptz
);

create index if not exists utm_attr_campaign_idx
  on utm_sales_attribution(campaign_id, is_active)
  where matched = true;

create index if not exists utm_attr_ad_idx
  on utm_sales_attribution(ad_id, is_active)
  where matched = true;

create index if not exists utm_attr_unmatched_idx
  on utm_sales_attribution(attributed_at desc)
  where matched = false;

alter table utm_sales_attribution enable row level security;
