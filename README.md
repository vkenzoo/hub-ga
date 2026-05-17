# Hub Central de Info-produtos

Monorepo do hub que consolida vendas (Assiny + Hotmart), provisiona acesso aos sistemas SaaS e centraliza analytics.

## Estrutura

```
hub/
├── apps/              # Next.js apps (webhooks, dashboard, public-api)
├── packages/          # Código compartilhado (db client, shared utils, email)
├── supabase/          # Migrations SQL e seed
└── scripts/           # Utilitários (snippet UTM, smoke tests)
```

## Pré-requisitos

- Node 20+
- pnpm 9+ — `npm i -g pnpm`
- Supabase CLI — `brew install supabase/tap/supabase`

## Setup inicial (Fase 1)

```bash
# 1. Instalar deps
pnpm install

# 2. Login no Supabase CLI
supabase login

# 3. Linkar com o projeto de STAGING primeiro (mais seguro)
supabase link --project-ref rukegfjcbevqttfpxvtp

# 4. Push das migrations
supabase db push

# 5. Rodar o seed
supabase db query --file supabase/seed.sql

# 6. Gerar tipos TS
pnpm db:types

# 7. Quando staging estiver OK, repetir 3-6 com produção
supabase link --project-ref ipsyrvocosjhzpgwxqxg
supabase db push
```

## Variáveis de ambiente

Veja `.env.example`. Nunca commitar `.env.local`.
