-- Entitlements: o que cada produto libera

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  kind entitlement_kind not null,
  system_id uuid references systems(id),
  tier text,
  cademi_course_id text,
  constraint chk_entitlement_shape check (
    (kind = 'system_access' and system_id is not null and tier is not null and cademi_course_id is null)
    or
    (kind = 'cademi_course' and cademi_course_id is not null and system_id is null and tier is null)
  )
);
create index entitlements_product_idx on entitlements (product_id);
