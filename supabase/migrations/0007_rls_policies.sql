-- RLS: ativa em tudo. service_role bypassa automaticamente.
-- anon/authenticated não acessam nada por padrão.

alter table customers enable row level security;
alter table systems enable row level security;
alter table products enable row level security;
alter table entitlements enable row level security;
alter table purchases enable row level security;
alter table subscriptions enable row level security;
alter table access_grants enable row level security;
alter table pending_jobs enable row level security;
alter table events_log enable row level security;
alter table admin_users enable row level security;
