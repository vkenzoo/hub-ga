-- Metadados extras de compra capturados do payload do gateway.
-- payment_method: PIX / CREDIT_CARD / BOLETO / BILLET / etc (texto livre, vem do gateway)
-- gateway_offer_id / _name: oferta do Assiny (não confundir com produto — uma oferta = variante de preço)
-- gateway_funnel_name: nome do funil (Assiny). Best-effort, pode ficar null se gateway não enviar.

alter table purchases
  add column if not exists payment_method text,
  add column if not exists gateway_offer_id text,
  add column if not exists gateway_offer_name text,
  add column if not exists gateway_funnel_name text;

create index if not exists purchases_payment_method_idx on purchases(payment_method);
