-- Pesquisas (Respondi.app) — recebe respostas via webhook e qualifica leads.
--
-- Tabelas:
--   survey_responses        — 1 linha por resposta recebida
--   lead_qualification_rules — regras pra classificar leads (Lead A/B/C/D/E)

create table survey_responses (
  id uuid primary key default gen_random_uuid(),
  respondi_respondent_id text not null,    -- UUID estável vindo do Respondi
  form_id text not null,                    -- ID do form no Respondi (ex: "CImh9589")
  form_name text,
  email text,                               -- extraído heuristicamente de answers
  phone text,                               -- extraído heuristicamente de answers
  phone_normalized text generated always as (
    case
      when phone is null then null
      when length(regexp_replace(phone, '\D', '', 'g')) < 8 then null
      else right(regexp_replace(phone, '\D', '', 'g'), 11)
    end
  ) stored,
  score int,                                -- score vindo do Respondi
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  answers jsonb default '{}'::jsonb,        -- {"Pergunta": "Resposta", ...}
  raw_answers jsonb default '[]'::jsonb,    -- array com IDs estáveis
  raw_payload jsonb,                        -- payload completo pra debug
  qualification text,                       -- a/b/c/d/e/null
  customer_id uuid references customers(id),  -- match por email/phone
  received_at timestamptz not null default now(),
  unique(respondi_respondent_id, form_id)   -- dedup
);

create index survey_responses_form_idx on survey_responses(form_id);
create index survey_responses_email_idx on survey_responses(email) where email is not null;
create index survey_responses_phone_idx on survey_responses(phone_normalized) where phone_normalized is not null;
create index survey_responses_qualification_idx on survey_responses(qualification) where qualification is not null;
create index survey_responses_received_idx on survey_responses(received_at desc);
create index survey_responses_customer_idx on survey_responses(customer_id) where customer_id is not null;

alter table survey_responses enable row level security;

-- Regras de qualificação. Quando múltiplas regras casam, vence a primeira (created_at).
create table lead_qualification_rules (
  id uuid primary key default gen_random_uuid(),
  form_id text,                              -- null = aplica em todos os forms
  question_key text not null,                -- texto da pergunta (chave em answers) OU id da pergunta em raw_answers
  match_type text not null default 'contains' check (match_type in ('contains', 'equals', 'starts_with', 'regex')),
  answer_pattern text not null,
  classification text not null check (classification in ('a', 'b', 'c', 'd', 'e')),
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_qualification_rules_active_idx on lead_qualification_rules(active, created_at) where active = true;

alter table lead_qualification_rules enable row level security;
