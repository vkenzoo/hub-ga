-- Transações: purchases, subscriptions, access_grants

create table purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  product_id uuid not null references products(id),
  gateway gateway not null,
  gateway_event_id text not null,
  amount numeric(12,2) not null,
  status purchase_status not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  affiliate_id text,
  created_at timestamptz not null default now(),
  unique (gateway, gateway_event_id)
);
create index purchases_customer_idx on purchases (customer_id);
create index purchases_created_idx on purchases (created_at desc);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  product_id uuid not null references products(id),
  gateway gateway not null,
  gateway_subscription_id text not null,
  status subscription_status not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway, gateway_subscription_id)
);
create index subscriptions_customer_idx on subscriptions (customer_id, status);

create table access_grants (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  entitlement_id uuid not null references entitlements(id),
  source_purchase_id uuid references purchases(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);
create index access_grants_customer_idx on access_grants (customer_id);
create index access_grants_expires_idx on access_grants (expires_at) where expires_at is not null;
