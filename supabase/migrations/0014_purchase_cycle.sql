-- Identifica qual ciclo de cobrança a compra representa. cycle=1 é primeira compra,
-- cycle>1 é renovação de assinatura. Permite calcular "receita de renovações"
-- separada de "receita de primeiras compras". Vendas avulsas ficam com cycle=null.

alter table purchases
  add column if not exists subscription_cycle int;

create index if not exists purchases_cycle_idx
  on purchases (subscription_cycle)
  where subscription_cycle is not null;
