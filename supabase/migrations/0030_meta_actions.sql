-- Métricas de evento do Pixel/CAPI Meta — count, não receita.
-- Receita continua sendo só UTM (decisão do user). Aqui só armazenamos
-- contagens pra calcular custo por evento (CPA, custo por LPV, custo por IC).

alter table meta_ad_insights_daily
  add column if not exists landing_page_views   bigint not null default 0,
  add column if not exists initiated_checkouts  bigint not null default 0;

comment on column meta_ad_insights_daily.landing_page_views is
  'Action landing_page_view do /insights (count de pessoas que carregaram LP)';
comment on column meta_ad_insights_daily.initiated_checkouts is
  'Action initiate_checkout (pixel) ou offsite_conversion.fb_pixel_initiate_checkout';
