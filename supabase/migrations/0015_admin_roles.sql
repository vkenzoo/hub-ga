-- Controle de acesso por papel. 2 níveis:
--   admin  = acesso total, pode gerenciar outros usuários (página /team)
--   member = acesso total ao hub, exceto gerenciar usuários

create type admin_role as enum ('admin', 'member');

alter table admin_users
  add column if not exists role admin_role not null default 'member',
  add column if not exists invited_by text,
  add column if not exists invited_at timestamptz;

-- Todos os admins existentes viram 'admin' pra não trancar ninguém de fora.
-- Demote manualmente quem deve ser só member depois.
update admin_users set role = 'admin' where role = 'member';

-- Recupera index sobre role pra filtros rápidos no /team
create index if not exists admin_users_role_idx on admin_users(role);
