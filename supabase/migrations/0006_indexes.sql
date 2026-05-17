-- Índice composto para acelerar consultas de grants ativos por customer.
-- Não usamos predicado com now() porque funções voláteis não são permitidas
-- em índices parciais. A filtragem por expires_at acontece na query da view.

create index access_grants_customer_entitlement_idx
  on access_grants (customer_id, entitlement_id);
