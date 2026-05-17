-- Duração configurável por entitlement
-- 'lifetime'             → acesso vitalício (expires_at = null)
-- 'follow_subscription'  → acesso até current_period_end da assinatura (renova quando webhook de renewal chega)
-- 'fixed_days'           → acesso por N dias a partir da compra

create type duration_mode as enum ('lifetime', 'follow_subscription', 'fixed_days');

alter table entitlements
  add column duration_mode duration_mode not null default 'lifetime',
  add column duration_days integer;

-- Para entitlements já cadastrados, infere o modo a partir do billing_type do produto
update entitlements e
set duration_mode = case p.billing_type
  when 'one_time'::billing_type        then 'lifetime'::duration_mode
  when 'recurring_monthly'::billing_type then 'follow_subscription'::duration_mode
  when 'recurring_yearly'::billing_type  then 'follow_subscription'::duration_mode
end
from products p
where p.id = e.product_id;

-- Liga grant à assinatura que o sustenta (necessário pra renovar/revogar em massa)
alter table access_grants
  add column subscription_id uuid references subscriptions(id);

create index access_grants_subscription_idx on access_grants(subscription_id) where subscription_id is not null;
