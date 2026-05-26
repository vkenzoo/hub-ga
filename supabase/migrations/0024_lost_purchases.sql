-- Vendas perdidas: PIX/boleto não pago, carrinho abandonado.
-- Espelha a estrutura de purchases mas é fonte de verdade pra recovery.

create table if not exists lost_purchases (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('assiny','hotmart')),
  kind text not null check (kind in ('pix_pending','pix_expired','billet_pending','billet_expired','cart_abandoned')),
  external_event_id text not null,

  email text,
  phone text,
  phone_normalized text,
  customer_id uuid references customers(id),

  product_gateway_id text,
  product_id uuid references products(id),
  product_name text,
  offer_name text,
  amount_cents int not null default 0,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,

  funnel_ref text,
  event_source_url text,
  payment_method text,
  expired_qr_code text,

  occurred_at timestamptz not null,
  resolved boolean not null default false,
  resolved_at timestamptz,

  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (platform, kind, external_event_id)
);

create index if not exists lost_purchases_occurred_at_idx
  on lost_purchases (occurred_at desc);
create index if not exists lost_purchases_email_idx
  on lost_purchases (email);
create index if not exists lost_purchases_phone_idx
  on lost_purchases (phone_normalized);
create index if not exists lost_purchases_open_idx
  on lost_purchases (kind, occurred_at desc) where resolved = false;

alter table lost_purchases enable row level security;
-- Sem policy de SELECT: só service-role vê (mesmo padrão de purchases/customers).
