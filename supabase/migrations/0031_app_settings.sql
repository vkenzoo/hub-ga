-- App settings (singleton). Configurações globais que valem pra todo o hub.
--
-- open_access: quando true, QUALQUER usuário autenticado no Supabase Auth
-- consegue entrar no admin (sem precisar estar no whitelist admin_users).
-- Recebe role 'member' com acesso a tudo, exceto gerenciar equipe.
-- Use com cuidado — qualquer pessoa com login no Supabase entra.

create table if not exists app_settings (
  id boolean primary key default true check (id),  -- singleton: só uma linha
  open_access boolean not null default false,
  open_access_updated_by text,
  open_access_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Garante que sempre exista uma linha
insert into app_settings (id) values (true) on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Só super admin pode ler/escrever via service role (RLS bloqueia anon/authenticated).
-- Acesso é via createSupabaseAdmin no dashboard.
