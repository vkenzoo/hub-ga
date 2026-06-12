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

-- Assiny NÃO recebe backfill de net: não tem afiliado e a taxa de gateway é
-- mínima, então receita = bruto (amount). O backfill antigo usava
-- transaction.net_amount (líquido da transação inteira: principal + bumps) e
-- gravava no principal, inflando o faturamento (net > bruto). Mantemos net_amount
-- NULL pra Assiny → dashboards usam o valor cheio.
