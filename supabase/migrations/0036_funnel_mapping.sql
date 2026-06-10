-- Mapeamento de oferta/produto → posição no funil, pra alimentar o KPI de funil.
--
-- Cada venda (purchases) é classificada numa posição (Produto Principal, Order Bump
-- 01-05, Upsell 01-02, Downsell 01-02) pra montar o grid diário e o comparativo de
-- meses (estilo KPI-DH).
--
-- Match (no app): por gateway_offer_id exato primeiro; senão por gateway_product_id
-- (oferta null = vale pra todas as ofertas daquele produto); senão "não mapeado".
--
-- Foco em Assiny (offer_id é capturado por venda; bumps já viram compras separadas).

create table if not exists funnel_mapping (
  id uuid primary key default gen_random_uuid(),
  gateway gateway not null default 'assiny',
  gateway_product_id text,            -- offer.product.id (null = casa só por oferta)
  gateway_offer_id text,              -- offer.id (null = vale p/ todas ofertas do produto)
  funnel_position text not null,      -- 'main' | 'order_01'.. | 'upsell_01' | 'downsell_01'..
  product_name text,                  -- snapshot p/ exibir na config
  offer_name text,                    -- snapshot p/ exibir
  price numeric(12,2),                -- preço de referência (opcional)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists funnel_mapping_offer_idx
  on funnel_mapping(gateway_offer_id) where gateway_offer_id is not null;
create index if not exists funnel_mapping_product_idx
  on funnel_mapping(gateway_product_id) where gateway_product_id is not null;

-- Evita duplicar regra pra mesma oferta no mesmo gateway
create unique index if not exists funnel_mapping_unique_offer
  on funnel_mapping(gateway, gateway_offer_id) where gateway_offer_id is not null;

alter table funnel_mapping enable row level security;
-- Sem policy: só service-role (createSupabaseAdmin) lê/escreve.
