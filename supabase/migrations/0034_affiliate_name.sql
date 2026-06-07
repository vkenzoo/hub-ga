-- Nome do afiliado (Hotmart manda affiliates[0].name junto do affiliate_code).
-- Antes só guardávamos o code (affiliate_id), que é ininteligível pra humano.
-- Agora guardamos o nome tb pra exibir na aba de Afiliados.
--
-- Só Hotmart tem afiliado real — Assiny sempre vem null (vide migration 0029).

alter table purchases
  add column if not exists affiliate_name text;

create index if not exists purchases_affiliate_idx
  on purchases (affiliate_id) where affiliate_id is not null;

-- Backfill: extrai o nome do afiliado do raw_body dos webhook_executions já
-- processados, casando por gateway_event_id. Pega só Hotmart com afiliado.
update purchases p
set affiliate_name = sub.aff_name
from (
  select
    we.gateway_event_id,
    we.raw_body::jsonb #>> '{data,affiliates,0,name}' as aff_name
  from webhook_executions we
  where we.gateway = 'hotmart'
    and we.raw_body::jsonb #>> '{data,affiliates,0,name}' is not null
) sub
where p.gateway = 'hotmart'
  and p.gateway_event_id = sub.gateway_event_id
  and p.affiliate_id is not null
  and p.affiliate_name is null;
