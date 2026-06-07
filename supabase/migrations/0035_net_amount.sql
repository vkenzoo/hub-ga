-- Receita LÍQUIDA real do produtor por venda (o que de fato cai na conta).
--
-- Antes a receita usava purchases.amount (valor cheio da venda). Isso supercontava
-- vendas de afiliado: numa venda de R$67 com afiliado, o produtor recebe só ~R$0,62
-- (o afiliado fica com ~R$61). Agora guardamos o líquido real:
--   Hotmart: commissions[source=PRODUCER].value   (já desconta Hotmart + afiliado)
--   Assiny:  transaction.net_amount / 100          (desconta taxa do gateway)
--
-- net_amount NULL = sem dado de comissão → dashboards caem no fallback (amount cheio).

alter table purchases
  add column if not exists net_amount numeric(12,2);

-- ── Backfill Hotmart: pega o value do source=PRODUCER no array commissions ──
update purchases p
set net_amount = sub.producer_val
from (
  select
    we.gateway_event_id,
    (
      select (c->>'value')::numeric
      from jsonb_array_elements(we.raw_body::jsonb #> '{data,commissions}') c
      where c->>'source' = 'PRODUCER'
      limit 1
    ) as producer_val
  from webhook_executions we
  where we.gateway = 'hotmart'
    and we.raw_body::jsonb #> '{data,commissions}' is not null
) sub
where p.gateway = 'hotmart'
  and p.gateway_event_id = sub.gateway_event_id
  and sub.producer_val is not null
  and p.net_amount is null;

-- ── Backfill Assiny (main): transaction.net_amount em centavos ──
update purchases p
set net_amount = (sub.net_cents::numeric / 100)
from (
  select
    we.gateway_event_id,
    coalesce(
      we.raw_body::jsonb #>> '{data,transaction,net_amount}',
      we.raw_body::jsonb #>> '{data,offer,amount_client}'
    ) as net_cents
  from webhook_executions we
  where we.gateway = 'assiny'
) sub
where p.gateway = 'assiny'
  and p.gateway_event_id = sub.gateway_event_id
  and sub.net_cents is not null
  and sub.net_cents ~ '^\d+$'
  and p.net_amount is null;
