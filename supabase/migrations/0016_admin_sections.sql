-- Acessos personalizados por seção. Quando allowed_sections é null o membro
-- tem acesso a todas as seções (comportamento padrão). Quando é um array,
-- só pode ver/acessar as seções listadas.
--
-- Admins (role='admin') ignoram esse campo — sempre têm acesso total.
-- Páginas /profile e /team não estão nessa lista: profile é sempre acessível,
-- /team é restrito a admin.

alter table admin_users
  add column if not exists allowed_sections text[];
