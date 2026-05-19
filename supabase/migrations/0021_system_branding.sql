-- Branding por sistema pros emails de boas-vindas.
-- Cada SaaS (SCALO, BlackBelt, GA Sales) tem sua logo + cor + email de resposta.
-- O hub envia tudo de noreply@hubgeracaoa.com mas com conteúdo branded.

alter table systems
  add column if not exists logo_url text,
  add column if not exists primary_color text default '#ec2d7c',
  add column if not exists reply_to_email text;
