-- Roteamento por FORMULÁRIO no forward de respostas do Respondi pro GHL.
--
-- Antes: qualquer form com "aplica" no nome era encaminhado a TODOS os destinos
-- subscritos a 'survey.application' (broadcast) — sem como mandar um form
-- específico pra um GHL específico.
--
-- Agora: cada destino tem um `form_filter`. Uma resposta do Respondi só é
-- encaminhada aos destinos cujo form_filter (normalizado) está CONTIDO no nome
-- do formulário. null = o destino NÃO recebe forward de form (precisa setar um
-- filtro) — evita broadcast acidental.
alter table outbound_webhooks add column if not exists form_filter text;

-- O webhook de Aplicação já existente continua recebendo só os forms "aplica".
update outbound_webhooks
set form_filter = 'aplica', updated_at = now()
where form_filter is null
  and events @> array['survey.application']::text[];
