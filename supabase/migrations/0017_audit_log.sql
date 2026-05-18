-- Rastreio de ações administrativas. Cada server action que altera estado
-- chama logAudit() e cria uma linha aqui. Permite responder "quem fez o quê
-- e quando" sem depender de logs de servidor que somem.

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,       -- ex: team.invite, team.role_change, execution.replay, product.update
  target text,                -- email, uuid, ou identificador legível do alvo
  payload jsonb,              -- detalhes (antes/depois, params, etc)
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_action_idx on audit_log (action);
create index audit_log_actor_idx on audit_log (actor_email);
create index audit_log_target_idx on audit_log (target) where target is not null;
