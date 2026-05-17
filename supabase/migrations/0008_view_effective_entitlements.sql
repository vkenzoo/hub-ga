-- View: tier mais alto válido por customer + (system | cademi_course)

create or replace view effective_entitlements as
with ranked as (
  select
    g.customer_id,
    e.kind,
    e.system_id,
    e.tier,
    e.cademi_course_id,
    case e.tier
      when 'unlimited'   then 3
      when 'full'        then 2
      when 'limited_100' then 1
      else 0
    end as tier_rank,
    g.granted_at,
    g.expires_at
  from access_grants g
  join entitlements e on e.id = g.entitlement_id
  where g.expires_at is null or g.expires_at > now()
)
select distinct on (customer_id, coalesce(system_id::text, cademi_course_id))
  customer_id,
  kind,
  system_id,
  tier,
  cademi_course_id,
  expires_at
from ranked
order by customer_id, coalesce(system_id::text, cademi_course_id), tier_rank desc;
