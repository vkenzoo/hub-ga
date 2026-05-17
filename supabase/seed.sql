-- Seed inicial: 3 sistemas, 4 produtos, entitlements, admin
-- Os IDs dos produtos no gateway (gateway_ids) precisam ser preenchidos
-- com os IDs reais do Assiny/Hotmart quando você cadastrar os produtos lá.

-- ============================================================
-- SISTEMAS
-- ============================================================
insert into systems (slug, name, supabase_url, service_key_env, base_app_url) values
  ('scalo',     'SCALO.AI',          'https://TODO.supabase.co', 'SCALO_SERVICE_ROLE_KEY',     'https://app.scalo.ai'),
  ('ga_sales',  'GA SALES MACHINE',  'https://TODO.supabase.co', 'GA_SALES_SERVICE_ROLE_KEY',  'https://app.gasalesmachine.com'),
  ('blackbelt', 'BLACKBELT SWIPE',   'https://TODO.supabase.co', 'BLACKBELT_SERVICE_ROLE_KEY', 'https://app.blackbeltswipe.com')
on conflict (slug) do nothing;

-- ============================================================
-- PRODUTOS
-- gateway_ids: preencher com os IDs reais quando cadastrar o
--              produto no Assiny e/ou Hotmart.
-- ============================================================
insert into products (name, billing_type, gateway_ids, requires_app_access) values
  ('Gerador de Vendas Automáticas',              'recurring_yearly',  '{"assiny":"TODO","hotmart":"TODO"}'::jsonb, true),
  ('Máquina de Vendas Automáticas no WhatsApp',  'recurring_yearly',  '{"assiny":"TODO","hotmart":"TODO"}'::jsonb, true),
  ('100 Ofertas Escaladas',                      'one_time',          '{"assiny":"TODO","hotmart":"TODO"}'::jsonb, true),
  ('BLACKBELT Mensal',                           'recurring_monthly', '{"assiny":"TODO","hotmart":"TODO"}'::jsonb, true)
on conflict do nothing;

-- ============================================================
-- ENTITLEMENTS
-- Decisão do dono: BLACKBELT Mensal NÃO libera curso adicional
-- na Cademí — só destrava tier 'unlimited' no SWIPE.
-- ============================================================

-- Gerador de Vendas Automáticas → SCALO.AI tier full
insert into entitlements (product_id, kind, system_id, tier)
select p.id, 'system_access', s.id, 'full'
from products p, systems s
where p.name = 'Gerador de Vendas Automáticas' and s.slug = 'scalo'
on conflict do nothing;

-- Máquina WhatsApp → GA SALES MACHINE tier full
insert into entitlements (product_id, kind, system_id, tier)
select p.id, 'system_access', s.id, 'full'
from products p, systems s
where p.name = 'Máquina de Vendas Automáticas no WhatsApp' and s.slug = 'ga_sales'
on conflict do nothing;

-- 100 Ofertas Escaladas → BLACKBELT tier limited_100
insert into entitlements (product_id, kind, system_id, tier)
select p.id, 'system_access', s.id, 'limited_100'
from products p, systems s
where p.name = '100 Ofertas Escaladas' and s.slug = 'blackbelt'
on conflict do nothing;

-- BLACKBELT Mensal → BLACKBELT tier unlimited (sem curso novo na Cademí)
insert into entitlements (product_id, kind, system_id, tier)
select p.id, 'system_access', s.id, 'unlimited'
from products p, systems s
where p.name = 'BLACKBELT Mensal' and s.slug = 'blackbelt'
on conflict do nothing;

-- ============================================================
-- ADMIN INICIAL
-- ============================================================
insert into admin_users (email) values ('vinnykenzo@gmail.com')
on conflict do nothing;
