-- Auto-cadastro de produtos via webhook. Quando um payload chega com gateway_product_id
-- que não existe no catálogo, criamos uma linha "draft" pra admin configurar depois.
-- pending_config=true significa "produto descoberto via webhook, ainda não configurado".
-- Webhooks com produto pending_config=true continuam sendo skipados (sem provisionar)
-- até admin marcar pending_config=false na UI.

alter table products
  add column if not exists pending_config boolean not null default false;

create index if not exists products_pending_config_idx
  on products (pending_config) where pending_config = true;
