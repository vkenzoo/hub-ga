-- Correção de bug: Assiny manda valores em centavos no payload, mas estávamos
-- armazenando em purchases.amount como se fosse reais (100x maior que o real).
--
-- Após o fix no extractAmount (apps/webhooks/src/lib/handlers/assiny.ts), novas
-- compras já entram corretas. Esta migration corrige o histórico.
--
-- IMPORTANTE: rodar 1 vez só. Idempotente NÃO é trivial — se rodar 2x divide
-- por 10.000. Por isso usa guard via flag em audit_log.

do $$
begin
  -- Guard: só roda se ainda não foi aplicado
  if not exists (
    select 1 from audit_log where action = 'migration.0028_fix_assiny_amounts'
  ) then
    update purchases
       set amount = amount / 100.0
     where gateway = 'assiny';

    insert into audit_log (actor, action, target, payload)
    values (
      'system',
      'migration.0028_fix_assiny_amounts',
      'purchases',
      jsonb_build_object(
        'description', 'Divide purchases.amount por 100 onde gateway=assiny',
        'applied_at', now()
      )
    );
  end if;
end $$;
