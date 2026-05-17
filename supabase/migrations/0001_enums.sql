-- Enums fundamentais do hub
create type billing_type as enum ('one_time','recurring_monthly','recurring_yearly');
create type gateway as enum ('assiny','hotmart');
create type purchase_status as enum ('paid','refunded','chargeback','pending');
create type subscription_status as enum ('active','past_due','cancelled','trialing');
create type entitlement_kind as enum ('system_access','cademi_course');
create type job_status as enum ('queued','processing','done','failed');
create type job_kind as enum ('provision_user','send_welcome_email','revoke_access');
