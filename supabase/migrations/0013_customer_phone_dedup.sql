-- Permite deduplicar clientes por telefone além de email. Normaliza o phone
-- pra apenas dígitos (últimos 11) pra ignorar formatos diferentes:
--   "+55 (11) 91234-5678", "11912345678", "5511912345678" → "11912345678"
--
-- Quando uma venda chega com email novo mas telefone que já existe na base,
-- o handler vai linkar à mesma linha de customers em vez de criar duplicata.

alter table customers
  add column if not exists phone_normalized text generated always as (
    case
      when phone is null then null
      when length(regexp_replace(phone, '\D', '', 'g')) < 8 then null
      else right(regexp_replace(phone, '\D', '', 'g'), 11)
    end
  ) stored;

create index if not exists customers_phone_normalized_idx
  on customers (phone_normalized)
  where phone_normalized is not null;
