-- Permite registrar webhooks de qualquer plataforma em webhook_executions,
-- não só payment gateways. A coluna era do tipo enum 'gateway' (assiny/hotmart),
-- vira text livre. Outras tabelas (purchases, subscriptions) continuam usando
-- o enum gateway porque são específicas de payment.

alter table webhook_executions
  alter column gateway type text using gateway::text;
