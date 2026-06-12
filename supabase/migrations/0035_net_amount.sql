-- Receita LÍQUIDA real do produtor — SÓ em venda de AFILIADO.
--
-- Em venda de afiliado o afiliado fica com uma parte e você recebe menos: numa
-- venda de R$67 o produtor recebe ~R$0,62. Aí a receita real = comissão PRODUCER.
-- Em venda DIRETA (sem afiliado) a receita é o valor cheio (amount) → net_amount
-- fica NULL e o dashboard usa amount.
--   Hotmart c/ afiliado: commissions[source=PRODUCER].value
--   Hotmart direto / Assiny: NULL → fallback amount (valor cheio)
--
-- net_amount NULL = usa o valor cheio no dashboard.

alter table purchases
  add column if not exists net_amount numeric(12,2);

-- ── Backfill Hotmart COM AFILIADO: comissão do PRODUCER ──
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
    and we.raw_body::jsonb #>> '{data,affiliates,0,affiliate_code}' is not null
) sub
where p.gateway = 'hotmart'
  and p.gateway_event_id = sub.gateway_event_id
  and p.affiliate_id is not null
  and sub.producer_val is not null;

-- Corrige instalações que já rodaram o backfill antigo (net em venda direta):
-- venda sem afiliado volta a usar o valor cheio.
update purchases set net_amount = null
where net_amount is not null and (affiliate_id is null or gateway <> 'hotmart');

-- Assiny NÃO recebe backfill de net: não tem afiliado e a taxa de gateway é
-- mínima, então receita = bruto (amount). O backfill antigo usava
-- transaction.net_amount (líquido da transação inteira: principal + bumps) e
-- gravava no principal, inflando o faturamento (net > bruto). Mantemos net_amount
-- NULL pra Assiny → dashboards usam o valor cheio.
