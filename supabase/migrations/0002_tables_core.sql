-- Tabelas-base: customers, systems, products

create table customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  phone text,
  name text,
  first_seen_at timestamptz not null default now(),
  source text
);
create index customers_email_lower_idx on customers (lower(email));

create table systems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  supabase_url text not null,
  service_key_env text not null,
  base_app_url text not null
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_type billing_type not null,
  gateway_ids jsonb not null default '{}'::jsonb,
  welcome_email_template_id text,
  requires_app_access boolean not null default true
);
create index products_gateway_ids_idx on products using gin (gateway_ids);
