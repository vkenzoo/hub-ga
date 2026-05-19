-- Simplifica campaign_rules removendo priority. Match passa a ser pela ordem
-- de criação (mais antiga ganha) quando múltiplas regras casarem com o mesmo
-- nome de campanha.

drop index if exists campaign_rules_active_idx;

alter table campaign_rules
  drop column if exists priority;

create index if not exists campaign_rules_active_idx on campaign_rules(active) where active = true;
