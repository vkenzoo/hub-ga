-- Limpa affiliate_id em purchases Assiny — o valor armazenado era o nome do
-- produtor (você), não um afiliado real. A partir do fix em assiny.ts, novas
-- compras já entram com affiliate_id=null.
--
-- Idempotente via guard em audit_log.

do $$
begin
  if not exists (
    select 1 from audit_log where action = 'migration.0029_clear_assiny_affiliate'
  ) then
    update purchases
       set affiliate_id = null
     where gateway = 'assiny'
       and affiliate_id is not null;

    insert into audit_log (actor_email, action, target, payload)
    values (
      'system',
      'migration.0029_clear_assiny_affiliate',
      'purchases',
      jsonb_build_object(
        'description', 'Limpa affiliate_id (continha nome do produtor) em purchases.gateway=assiny',
        'applied_at', now()
      )
    );
  end if;
end $$;
