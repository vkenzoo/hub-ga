-- Antes só salvávamos qr_code pra pix_expired. Agora salvamos pra pix_pending tb
-- (assim a tela de recuperação consegue copiar o código pra mandar via WhatsApp).
--
-- Estratégia ADITIVA pra não quebrar durante o deploy:
--   1. Adiciona coluna nova pix_qr_code
--   2. Backfill: copia de expired_qr_code (campo antigo) E extrai do raw_payload
--   3. Mantém expired_qr_code por enquanto (deprecated, remove em migration futura)
--
-- Quando o webhook deploy subir, ele passa a inserir em pix_qr_code direto.

alter table lost_purchases
  add column if not exists pix_qr_code text;

-- Backfill 1: copia dos registros que já tinham expired_qr_code
update lost_purchases
set pix_qr_code = expired_qr_code
where pix_qr_code is null
  and expired_qr_code is not null;

-- Backfill 2: extrai qr_code do raw_payload pros pix_pending que perderam.
-- (esses nunca tiveram expired_qr_code porque antes só salvávamos pra expired)
update lost_purchases
set pix_qr_code = raw_payload #>> '{data,transaction,additional_data,PIX,qr_code}'
where pix_qr_code is null
  and kind in ('pix_pending','pix_expired')
  and platform = 'assiny'
  and raw_payload #>> '{data,transaction,additional_data,PIX,qr_code}' is not null;
