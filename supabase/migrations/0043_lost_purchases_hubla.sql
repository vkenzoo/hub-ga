-- Libera platform='hubla' em lost_purchases.
--
-- A 0024 criou lost_purchases.platform com check (platform in ('assiny','hotmart')).
-- A 0041 adicionou 'hubla' ao enum `gateway`, mas essa coluna é TEXT com CHECK
-- próprio, então continuou recusando. Efeito: todo evento de venda perdida da
-- Hubla (PIX pendente/expirado, cartão recusado etc.) falhava com
-- "violates check constraint lost_purchases_platform_check" e não aparecia em
-- /recovery. Não afeta geração de acesso (vendas pagas vão para purchases).
alter table lost_purchases drop constraint if exists lost_purchases_platform_check;
alter table lost_purchases
  add constraint lost_purchases_platform_check
  check (platform in ('assiny', 'hotmart', 'hubla'));
