// Guias internos do time. Editados via PR no código (não há UI de edição).
// Adicione novos guias aqui e a página /guides automaticamente lista.
//
// Convenção:
//   slug: kebab-case, único, vai pra URL (/guides/slug)
//   title: título curto que aparece nos cards
//   category: agrupa na home /guides (uma categoria por linha visual)
//   summary: 1 frase resumindo (aparece no card)
//   content: markdown completo do guia
//   updatedAt: ISO date da última atualização significativa
//   featured (opcional): destaca no topo da página índice
//   icon (opcional): override do ícone do card (senão usa o da categoria)

export type GuideCategory =
  | "operacao"
  | "vendas"
  | "produtos"
  | "equipe"
  | "integracoes"
  | "emails";

export const CATEGORY_LABEL: Record<GuideCategory, string> = {
  operacao: "Operação do dia a dia",
  vendas: "Vendas e clientes",
  produtos: "Produtos e acessos",
  equipe: "Equipe e permissões",
  integracoes: "Integrações",
  emails: "Emails e comunicações",
};

export const CATEGORY_SHORT: Record<GuideCategory, string> = {
  operacao: "Operação",
  vendas: "Vendas",
  produtos: "Produtos",
  equipe: "Equipe",
  integracoes: "Integrações",
  emails: "Emails",
};

export const CATEGORY_DESC: Record<GuideCategory, string> = {
  operacao: "Como o sistema funciona, onde olhar quando algo dá errado.",
  vendas: "Acompanhar clientes, vendas, recuperação e reembolsos.",
  produtos: "Cadastrar, configurar e liberar acessos automaticamente.",
  equipe: "Convites, papéis e permissões granulares.",
  integracoes: "Plataformas externas conectadas ao hub.",
  emails: "Mensagens automáticas enviadas pelo sistema.",
};

// Cor (token Tailwind) usada no chip/borda do card por categoria.
export const CATEGORY_COLOR: Record<GuideCategory, string> = {
  operacao: "brand",
  vendas: "accent",
  produtos: "info",
  equipe: "warn",
  integracoes: "brand",
  emails: "accent",
};

const CATEGORY_ORDER: GuideCategory[] = [
  "operacao",
  "vendas",
  "produtos",
  "equipe",
  "integracoes",
  "emails",
];

export interface Guide {
  slug: string;
  title: string;
  category: GuideCategory;
  summary: string;
  content: string;
  updatedAt: string;
  featured?: boolean;
}

export const GUIDES: Guide[] = [
  // ─────────────────────────── OPERAÇÃO ───────────────────────────
  {
    slug: "comecando-por-aqui",
    title: "Começando por aqui",
    category: "operacao",
    summary: "Tour geral do hub em 5 minutos. Por onde abrir, o que cada aba faz.",
    updatedAt: "2026-05-22",
    featured: true,
    content: `# Começando por aqui

Esse guia te dá um tour de 5 minutos pelo hub. Se você nunca usou, leia esse antes dos outros.

## O que o hub faz

Centraliza tudo que acontece em vendas, clientes e acessos da Geração A. Os gateways (Assiny e Hotmart) mandam webhook → hub processa → cria cliente, registra venda, provisiona acesso nos SaaS (SCALO, BLACKBELT, GA Sales).

## As 14 abas, agrupadas

### Grupo "Geral" (todo membro pode ver, dependendo da permissão)

| Aba | Pra que serve |
|---|---|
| **Resumo** | Visão executiva: faturamento, ticket médio, top produtos |
| **Aquisição** | Métricas de vendas vindas de aquisição (front-end) |
| **Pesquisa** | Respostas da Respondi e qualificação de leads A/B/C/D/E |
| **Vendas** | Lista cronológica de vendas pagas, com filtros |
| **Recuperação** | PIX expirado, carrinho abandonado, boleto não pago |
| **Reembolsos** | Estornos e chargebacks com taxa de reembolso |
| **Assinaturas** | Status de cada assinatura ativa/cancelada |
| **Clientes** | Lista de clientes, histórico, busca |
| **Sistemas** | SaaS conectados (SCALO, BLACKBELT, GA Sales) |
| **Produtos** | Catálogo + entitlements |
| **Guias** | Você tá aqui 👋 |

### Grupo "Admin" (só super admin vê)

| Aba | Pra que serve |
|---|---|
| **Conexões** | Credenciais de Assiny, Hotmart, Meta Ads, Cademí, Respondi |
| **Webhooks** | URLs de entrada e saída |
| **Executions** | Log de TODO webhook que chegou (debug) |
| **Equipe** | Convidar/gerenciar membros |
| **Auditoria** | Quem fez o que (replays, edições, remoções) |

## Como navegar

* Sidebar à esquerda em desktop, drawer em mobile (hamburguer no topo)
* Click no avatar no rodapé pra editar perfil ou trocar foto
* Quase toda aba tem filtro de período no canto direito (Hoje / 7d / 30d / Mês / Tudo / Personalizado)

## Onde olhar quando algo dá errado

| Sintoma | Onde olhar |
|---|---|
| Venda não apareceu | **/executions** (filtra por gateway + período) |
| Cliente não recebeu email | **/customers/[id]** → aba "Provisionamentos" |
| Webhook chegou mas falhou | **/executions** → abre a execution → vê \`error_message\` |
| Membro perdeu acesso | **/team** (admin) ou **/audit** (histórico) |

## Próximos guias

Depois desse, recomendo na ordem:
1. **O que acontece quando uma venda chega** (fluxo completo)
2. **Como cadastrar um produto novo**
3. **Entendendo a aba /sales**
4. **Recuperando vendas perdidas** (recovery)
`,
  },

  {
    slug: "fluxo-de-uma-venda",
    title: "O que acontece quando uma venda chega",
    category: "operacao",
    summary: "Linha do tempo completa desde o webhook até o cliente receber o acesso.",
    updatedAt: "2026-05-19",
    featured: true,
    content: `# O que acontece quando uma venda chega

Esse é o fluxo completo do hub do momento que o gateway dispara o webhook até o cliente receber o email com acesso.

## Etapa 1. Webhook chega

O gateway (Assiny ou Hotmart) faz POST pra uma das nossas URLs:

\`\`\`
POST https://webhooks.hubgeracaoa.com/api/webhooks/assiny
POST https://webhooks.hubgeracaoa.com/api/webhooks/hotmart
\`\`\`

Cada hit cria uma linha em **webhook_executions** com o payload bruto, headers e timestamp. Você consegue ver em **/executions**.

## Etapa 2. Validação de autenticidade

O hub valida que o webhook é real:

1. Confere assinatura HMAC (Assiny) ou Hottok (Hotmart)
2. Se inválido, marca como \`rejected_auth\` (chip vermelho)
3. Se válido, parseia o body e classifica o evento

## Etapa 3. Classificação do evento

O hub identifica o tipo:

* **purchase.paid** → venda nova
* **subscription.renewed** → renovação automática
* **purchase.refunded** → reembolso
* **subscription.cancelled** → cancelamento
* **subscription.past_due** → cartão recusou
* **lost:pix_pending / pix_expired** → PIX gerado / expirado (venda perdida)
* **lost:cart_abandoned** → saiu sem pagar

## Etapa 4. Resolução do produto

O hub busca o produto pelo \`gateway_product_id\` em **products**:

1. Encontrou e está configurado: prossegue
2. Encontrou mas \`pending_config=true\` (rascunho): skipa como \`unknown_product\`
3. Não encontrou: auto-cria rascunho e skipa como \`unknown_product\`

> Vendas de produtos não configurados **não contam no faturamento** dos dashboards.

## Etapa 5. Cliente é encontrado ou criado

O hub busca o cliente por **email** primeiro. Se não achar, tenta por **telefone normalizado** (últimos 11 dígitos). Se encontrar via telefone com email diferente, agrega na mesma linha (audit registra \`customer.merged_by_phone\`).

## Etapa 6. Registro da compra

Cria linha em **purchases** com:

* Valor, status, gateway
* UTMs (origem, campanha, conteúdo, etc)
* Método de pagamento (PIX, Cartão, Boleto)
* ID da oferta e funil Assiny
* Ciclo da assinatura (1 = primeira compra, 2+ = renovação)

## Etapa 7. Provisionamento

Pra cada **entitlement** do produto:

1. Cria conta no SaaS correspondente (SCALO, BB, GA Sales) com senha temporária
2. Insere linha em **access_grants** com prazo (vitalício, segue assinatura, ou X dias)
3. Dispara **email de boas-vindas** com logo e cor do sistema

## Etapa 8. Auditoria

Tudo fica registrado em:

* **/executions** — payload bruto, status, duração
* **events_log** — timeline interna por etapa
* **/audit** — quem fez o que (replays, edições)

## Quando algo dá errado

| Status | O que fazer |
|---|---|
| \`rejected_auth\` | Confere se Hottok no gateway bate com env var no Vercel |
| \`unknown_product\` | Vai em /products e configura o rascunho recém-criado |
| \`failed\` | Lê \`error_message\` na execution, corrige a causa, clica **Reprocessar** |
| \`invalid_payload\` | Gateway mandou algo fora do schema; investigar |

## Reprocessar manualmente

Se uma execution caiu como \`unknown_product\` ou \`failed\` e a causa foi resolvida, abre a execution e clica **Reprocessar** no canto superior direito. O hub refaz a chamada do webhook com o payload original.
`,
  },

  {
    slug: "reprocessar-execution",
    title: "Como reprocessar uma execution",
    category: "operacao",
    summary: "Quando uma venda foi skipada por config errada e você quer recuperar.",
    updatedAt: "2026-05-19",
    content: `# Como reprocessar uma execution

Útil quando uma venda chegou mas não foi processada por algum problema, e a causa já foi resolvida.

## Cenários comuns

| Status original | Causa típica | Resolveu? Reprocessa |
|---|---|---|
| \`unknown_product\` | Produto não estava cadastrado | Cadastrou e configurou → ✅ |
| \`failed\` | Bug temporário no provisioning | Bug corrigido → ✅ |
| \`missing_data\` | Payload faltou campo | Dados disponíveis agora → ✅ |
| \`rejected_auth\` | Hottok diferente entre gateway e hub | ❌ Não reprocesse, ajuste o Hottok primeiro |
| \`invalid_payload\` | Gateway mandou JSON malformado | ❌ Reprocessar não resolve |

## Passo a passo

1. Vai em **/executions**
2. Filtra por status (ex: \`Produto desconhecido\` se foi auto-draft)
3. Clica numa execution pra abrir o detalhe
4. No canto superior direito, clica **🔄 Reprocessar**

O hub:

1. Pega o \`raw_body\` original armazenado
2. Pega os \`raw_headers\` originais (sem mascarar)
3. Faz POST de novo pra própria URL do webhook
4. Cria uma nova execution com timestamp atual
5. A original continua intacta (histórico preservado)

> Importante: a deduplicação por \`gateway_event_id\` se aplica a **purchases**, não a execuções. Se a venda original não chegou a criar purchase, a nova vai criar. Se já tem purchase, vai detectar duplicate e skipar.

## Verificar resultado

Volta em **/executions** e olha a linha mais recente:

* ✅ Status verde \`Processado\` — venda recuperada com sucesso
* 🟡 Ainda \`unknown_product\` — produto ainda não está configurado certo, revisa
* 🔴 \`failed\` — causa não foi resolvida, lê o \`error_message\`

## Audit log

Toda execução de **Reprocessar** vai pra **/audit** com action \`execution.replay\`, atribuída ao admin que clicou.
`,
  },

  {
    slug: "filtros-de-periodo",
    title: "Filtros de período (Hoje, 7d, 30d, Mês, Custom)",
    category: "operacao",
    summary: "Como o hub calcula 'Hoje' vs '30d' e como usar o filtro personalizado.",
    updatedAt: "2026-05-22",
    content: `# Filtros de período

Quase todo dashboard tem chips no topo: **Hoje · 7d · 30d · Mês · Tudo · 📅 Personalizado**.

## Como cada um é calculado

Tudo em fuso **BRT (America/Sao_Paulo)** — sem horário de verão (Brasil não usa desde 2019).

| Chip | O que pega |
|---|---|
| **Hoje** | Da meia-noite BRT de hoje até agora |
| **7d** | Últimos 7 dias (inclui hoje) |
| **30d** | Últimos 30 dias (inclui hoje) |
| **Mês** | Do dia 1 desse mês até agora |
| **Tudo** | Sem filtro de data (lifetime) |
| **Personalizado** | Você escolhe **De** e **Até** (date pickers) |

## Personalizado

Click em **📅 Personalizado** abre 2 campos:

1. **De** — data de início (inclusiva)
2. **Até** — data de fim (inclusiva)

Clica **Aplicar** e a URL fica algo como:

\`\`\`
/sales?period=custom&from=2026-05-01&to=2026-05-15
\`\`\`

Boa pra reports específicos (ex: "vendas da semana do lançamento").

## Padrão de cada página

Cada aba decide qual é o default:

| Aba | Default |
|---|---|
| **/resumo** | 30d |
| **/sales** | (sem filtro de período — usa filtros de gateway/status) |
| **/acquisition** | 30d |
| **/recovery** | 30d |
| **/refunds** | 30d |
| **/surveys** | 30d |

## Por que BRT e não UTC

A Vercel roda em UTC. Sem timezone explícito, "hoje" seria das 21h às 21h (3h atrás). Pra evitar esse offset, calculamos cutoff em BRT com offset fixo de **-3h** e renderizamos todas as datas com \`timeZone: "America/Sao_Paulo"\`.
`,
  },

  // ─────────────────────────── VENDAS ───────────────────────────
  {
    slug: "entendendo-aba-vendas",
    title: "Entendendo a aba /sales",
    category: "vendas",
    summary: "O que cada coluna significa, filtros, busca, e como exportar pra CSV.",
    updatedAt: "2026-05-22",
    featured: true,
    content: `# Entendendo a aba /sales

A lista cronológica de toda venda registrada no hub.

## O que aparece

Cada linha é uma venda **paga** (\`status='paid'\`) ou **reembolsada** / **chargeback**. PIX expirado e carrinho abandonado **não** aparecem aqui — vão pra **/recovery**.

## Colunas

| Coluna | O que mostra |
|---|---|
| **Data** | Quando a venda chegou no hub (fuso BRT) |
| **Valor** | Quanto entrou de receita bruta |
| **Status** | Pago / Estornado / Chargeback |
| **Cliente** | Email do comprador (linka pra /customers/[id]) |
| **Plataforma** | Assiny ou Hotmart |
| **Pagamento** | PIX / Cartão / Boleto |

## Colunas opcionais

Click no botão **Colunas** (ou pelo menu de personalização) pra ativar:

* **Produto** — nome do produto vendido
* **Funil** — ID curto do funil Assiny (ex: \`hncFVu\`)
* **Oferta** — nome da variante (ex: "Oferta Black Friday")
* **Origem** — utm_source
* **Campanha** — utm_campaign
* **Afiliado** — código do afiliado (se houver)
* **Mídia / Anúncio / Termo** — utm_medium / content / term

Cada usuário tem seu próprio padrão de colunas (salvo via querystring).

## Filtros

No topo:

* **Plataforma** — Assiny / Hotmart / todas
* **Status** — Pago / Estornado / Chargeback / todos
* **Busca livre** — procura por email, nome do cliente, ou nome do produto

## Exportar pra CSV

Botão **📥 Exportar CSV** no canto superior direito gera arquivo com TODAS as colunas (não só as que você ativou). Útil pra dar pro contador ou cruzar com planilha externa.

## O que NÃO aparece aqui

* **Renovações de assinatura** aparecem aqui (são compras com \`subscription_cycle ≥ 2\`)
* **PIX/Boleto não pago** vai em **/recovery**
* **Reembolsos** aparecem aqui MAS também em **/refunds** com mais contexto

## Limite

Por enquanto, lista até **200 linhas mais recentes**. Pra ver mais antigo, use filtro de período custom + exportar CSV.
`,
  },

  {
    slug: "recuperar-vendas-perdidas",
    title: "Recuperando vendas perdidas (/recovery)",
    category: "vendas",
    summary: "PIX expirado, boleto não pago, carrinho abandonado — como agir.",
    updatedAt: "2026-05-22",
    featured: true,
    content: `# Recuperando vendas perdidas

A aba **/recovery** mostra dinheiro na mesa esperando você ir buscar.

## O que aparece aqui

| Tipo | Quando entra |
|---|---|
| **PIX aguardando** | Cliente gerou PIX, ainda dentro do prazo |
| **Boleto aguardando** | Boleto gerado, ainda não venceu |
| **PIX expirado** | Cliente gerou PIX e não pagou no prazo |
| **Boleto expirado** | Boleto venceu sem pagamento |
| **Carrinho abandonado** | Cliente saiu do checkout sem chegar a gerar pagamento |

## Os 4 stat cards no topo

1. **Em aberto** — soma de PIX e boletos aguardando (ainda recuperáveis hoje)
2. **Expirado** — soma do que já passou do prazo
3. **Carrinho abandonado** — quantos saíram do checkout
4. **Total perdido** — expirado + abandonado no período

## Como recuperar

### PIX/Boleto expirado

1. Filtra por **Expirado**
2. Click no botão **WhatsApp** ao lado do cliente
3. Mensagem padrão: "Oi! Vi que você gerou o PIX pro [produto] mas não chegou a pagar. Quer que eu gere um novo link pra você?"
4. Se ele quiser, gere um novo link no Assiny/Hotmart manualmente e envia

> Hoje **não geramos PIX novo automaticamente**. Vai chegar em fase 2.

### Carrinho abandonado

1. Filtra por **Abandonado**
2. Click em **Checkout** — abre a URL exata onde o cliente parou
3. Click em **WhatsApp** — manda mensagem sobre dúvidas/desconto

> Não tem como recuperar via link único — só convidando de volta pelo WhatsApp/Instagram/Email.

## Quem vê

Section-controlled. Membro precisa ter \`recovery\` no \`allowed_sections\` pra ver.

## Lifecycle automático

Quando o cliente volta e paga (mesmo \`tx_id\`):

1. \`PURCHASE_APPROVED\` chega no webhook
2. Hub registra como purchase normal em **/sales**
3. Hub marca a linha em **/recovery** como **resolved** (some da lista de "aberto", continua no histórico)

## Filtros disponíveis

* **Período** — Hoje / 7d / 30d / Mês / Tudo / Custom
* **Tipo** — Tudo / Aguardando / Expirado / Abandonado
`,
  },

  {
    slug: "entendendo-reembolsos",
    title: "Entendendo a aba /refunds e taxa de reembolso",
    category: "vendas",
    summary: "Como ler estornos e chargebacks, e o que significa a taxa de reembolso.",
    updatedAt: "2026-05-22",
    content: `# Entendendo /refunds

Acompanhe estornos (reembolsos) e chargebacks (contestações de cartão).

## Diferença entre os 2

| Tipo | O que é |
|---|---|
| **Reembolso** | Cliente pediu e Assiny/Hotmart concedeu (geralmente dentro de 7 dias) |
| **Chargeback** | Cliente contestou direto na bandeira do cartão (mais grave, taxa extra) |

## Stat cards

1. **Reembolsado** — R$ + count de estornos no período
2. **Chargeback** — R$ + count
3. **Total perdido** — soma dos 2
4. **Taxa de reembolso** — % com hint "X de Y alunos"

## A taxa de reembolso explicada

A taxa é calculada **só com produtos de role='acquisition'** (front-end), porque reembolso de monetização tem dinâmica diferente.

\`\`\`
Taxa = Reembolsos únicos / Alunos únicos
\`\`\`

* **Alunos únicos** = quantos clientes diferentes pagaram um produto de aquisição no período
* **Reembolsos únicos** = quantos clientes diferentes reembolsaram um produto de aquisição no período

Um cliente que reembolsou 2 produtos diferentes conta como **1 reembolso** (único).

## Como agir

1. Filtra por período (semana / mês / etc)
2. Vê a taxa — saudável fica abaixo de **5%**; acima de 8% é sinal vermelho
3. Click no email do cliente pra ver histórico
4. Se tiver phone, click **WhatsApp** pra entender o motivo (se for chargeback recente)

## Importante

* Reembolso revoga acessos automaticamente (\`access_grants\` ficam \`revoked\`)
* O email com login NÃO é retirado, mas a conta no SaaS perde permissão
* Audit log registra \`purchase.refunded\` ou \`purchase.chargeback\`
`,
  },

  {
    slug: "historico-de-cliente",
    title: "Vendo histórico completo de um cliente",
    category: "vendas",
    summary: "Tudo que um cliente já comprou, assinou, reembolsou, em um lugar só.",
    updatedAt: "2026-05-22",
    content: `# Vendo histórico de um cliente

A página **/customers/[id]** consolida tudo de um cliente único.

## Como chegar

3 caminhos:

1. **/customers** → busca por nome ou email → click na linha
2. **/sales** → click no email da linha → vai direto pra customer
3. **/recovery** ou **/refunds** → click no email → mesmo destino

## O que mostra

### Cabeçalho
* Nome, email, telefone
* Tag se virou cliente via Assiny ou Hotmart primeiro
* Data do primeiro contato

### Tab "Compras"
Lista cronológica de todas as compras (pagas + reembolsadas):
* Data, valor, produto, status

### Tab "Assinaturas"
Status atual de cada assinatura:
* Ativa / Past due / Cancelada
* Próxima cobrança
* Ciclo (1 = primeira, 2+ = renovação)

### Tab "Provisionamentos"
\`access_grants\` desse cliente:
* Qual sistema (SCALO, BB, GA Sales)
* Qual nível (full, limited_100)
* Quando expira (vitalício / X dias / segue assinatura)
* Status (active / revoked / expired)

### Tab "Pesquisas"
Respostas que ele deu no Respondi, com qualificação A/B/C/D/E.

### Tab "Eventos"
Timeline de tudo que aconteceu nesse cliente:
* Criação, merge por telefone
* Cada provisionamento
* Mudanças de status de assinatura

## Pra que serve no dia a dia

* Cliente liga reclamando que não recebeu acesso → tab Provisionamentos mostra se foi disparado
* Quer saber qual produto ele comprou primeiro → tab Compras
* Comercial quer saber se já é lead A → tab Pesquisas
`,
  },

  // ─────────────────────────── PRODUTOS ───────────────────────────
  {
    slug: "cadastrar-produto",
    title: "Como cadastrar um produto novo",
    category: "produtos",
    summary: "Passo a passo pra ligar produto do Assiny/Hotmart ao hub e liberar acesso automático.",
    updatedAt: "2026-05-19",
    featured: true,
    content: `# Como cadastrar um produto novo

Tem 2 caminhos: deixar o hub auto-criar quando a primeira venda chegar, ou criar manualmente antes.

## Caminho A. Auto-cadastro via webhook (preferido)

1. Vende o produto no Assiny/Hotmart
2. Webhook chega, hub não acha → cria rascunho automaticamente em **/products** com:
   * Nome puxado do payload
   * \`gateway_id\` preenchido
   * \`pending_config = true\` (não conta no faturamento ainda)
3. Você vai em **/products**, clica no card destacado em amarelo
4. Configura o que falta (ver próximas seções)
5. Clica **Marcar como configurado**

Pronto. Próximas vendas desse produto provisionam automático.

## Caminho B. Cadastro manual (proativo)

1. Vai em **/products**
2. Form no topo: preenche **Nome** e **Tipo de cobrança**
3. Clica **Criar produto**
4. Abre o produto recém-criado
5. Preenche o restante (ver próximas seções)

## Campos obrigatórios

### Identificação

Em **Dados do produto**:

1. **Nome** — como aparece no hub e nos emails
2. **Tipo de cobrança**: Avulso, Mensal ou Anual
3. **ID do produto no Assiny** — UUID que aparece em pay.assiny.com.br
4. **ID do produto no Hotmart** — número de ~7 dígitos
5. **Esse produto libera acesso em algum sistema SaaS?** — marca se for SCALO/BB/GA Sales

### Categoria de receita

3 opções:

1. **Aquisição** — front-end, conta em **/acquisition**
2. **Monetização** — upsells, recorrências, conta no dash de monetização futuro
3. **Outro** — não classificado, não aparece em nenhum dos 2 dashs

> Sempre escolha uma das 3. Se deixar "Outro", o produto fica invisível pros dashboards.

### Entitlements (o que o produto libera)

Em **O que esse produto libera quando vendido**, clica em **Adicionar acesso a um sistema**:

1. **Sistema** — SCALO, BLACKBELT SWIPE, ou GA SALES MACHINE
2. **Nível**:
   * \`full\` — acesso completo
   * \`limited_100\` — limitado a 100 ofertas (só BLACKBELT)
   * \`unlimited\` — ilimitado (BLACKBELT recorrente)
3. **Duração**:
   * Acesso pra sempre (vitalício)
   * Enquanto a assinatura estiver paga
   * 7 / 15 / 30 / 60 / 90 / 180 / 365 / 730 dias

Pode adicionar múltiplos entitlements se o produto libera mais de um sistema.

## Quando NÃO precisa entitlement

Se o produto é só Cademí (curso fechado), não precisa configurar entitlement no hub. A Cademí integra direto com Assiny/Hotmart. O hub registra a venda mas não provisiona nada além disso.

Nesse caso, na seção **Dados do produto**, **desmarca** "Esse produto libera acesso em algum sistema SaaS".
`,
  },

  {
    slug: "aquisicao-vs-monetizacao",
    title: "Aquisição vs Monetização vs Outro",
    category: "produtos",
    summary: "Por que essa categorização existe e onde cada uma aparece nos dashboards.",
    updatedAt: "2026-05-22",
    content: `# Aquisição vs Monetização vs Outro

Toda venda do hub é classificada por essa flag no produto (\`role\`). Define em qual dashboard ela conta.

## As 3 categorias

### Aquisição (front-end)

Produtos que **trazem o cliente pela primeira vez**. Típico: tripwire de R$ 7, R$ 27, R$ 47.

* Aparece no dashboard **/acquisition**
* É o numerador da **taxa de reembolso** em /refunds
* Conta nos targets de **CPA** e **ROAS** da equipe de mídia

### Monetização (back-end)

Produtos vendidos pra quem **já é cliente**. Upsells, recorrências, lançamentos premium.

* Aparece num dashboard de monetização futuro (ainda não implementado)
* NÃO conta na taxa de reembolso de aquisição

### Outro

Tudo que não cabe em nenhum dos 2:
* Produtos de teste
* Vouchers / brindes
* Pagamentos avulsos não-comerciais

* **NÃO** aparece em nenhum dashboard
* Continua contando no /sales geral, mas ignorado por métricas estratégicas

## Como mudar a categoria

1. **/products** → click no produto
2. Seção **Categoria de receita**
3. Marca a opção certa
4. **Salvar**

Mudança vale pra **todas as compras passadas** (não é por compra, é por produto). Útil pra reclassificar histórico.

## Regra prática

| Pergunta | Categoria |
|---|---|
| "Esse produto traz cliente novo pro funil?" | Aquisição |
| "Esse produto é vendido depois pra cliente já existente?" | Monetização |
| "Esse produto não tem rotina comercial — é avulso/teste/brinde" | Outro |
`,
  },

  {
    slug: "como-funciona-entitlement",
    title: "Como funciona o entitlement (acesso) de um produto",
    category: "produtos",
    summary: "Sistema + nível + duração: a tríade que define o que o cliente recebe.",
    updatedAt: "2026-05-22",
    content: `# Como funciona o entitlement

Quando uma venda é registrada, o hub precisa saber **o que liberar** pro cliente. Isso é o **entitlement**.

## Anatomia

Cada entitlement tem 3 partes:

\`\`\`
Sistema   ×  Nível    ×  Duração
SCALO     ×  full     ×  vitalício
BLACKBELT ×  limited_100 ×  enquanto assinatura
GA SALES  ×  full     ×  90 dias
\`\`\`

## Sistemas disponíveis

| Sistema | Slug |
|---|---|
| SCALO.AI (Milio.AI) | \`scalo\` |
| BLACKBELT SWIPE | \`blackbelt\` |
| GA SALES MACHINE (Zapzap) | \`ga_sales\` |

## Níveis

| Nível | Significa |
|---|---|
| \`full\` | Acesso completo às features |
| \`limited_100\` | Limitado a 100 ofertas (BLACKBELT) |
| \`unlimited\` | Ofertas ilimitadas (BLACKBELT recorrente) |

## Durações

| Opção | O que faz |
|---|---|
| **Acesso pra sempre** | Vitalício. Não expira. |
| **Enquanto assinatura paga** | Expira quando a assinatura cancela ou fica past_due |
| **7 / 15 / 30 / 60 / 90 / 180 / 365 / 730 dias** | Fixo a partir da data de pagamento |

## Múltiplos entitlements por produto

Um produto pode liberar mais de um sistema. Ex: bundle "Geração A Pro" pode dar SCALO + BLACKBELT + GA SALES.

Pra adicionar: na página do produto, **+ Adicionar acesso a um sistema** quantas vezes precisar.

## O que acontece quando reembolsa

\`access_grants\` daquela purchase ficam \`revoked\` automaticamente. Acesso ao SaaS é cortado.

Quando a assinatura cancela com \`Enquanto assinatura paga\`, vira \`expired\` no fim do período pago (não imediato).
`,
  },

  // ─────────────────────────── EQUIPE ───────────────────────────
  {
    slug: "convidar-membro",
    title: "Como convidar um membro pra equipe",
    category: "equipe",
    summary: "Cria acesso ao hub pra outras pessoas com nível Admin ou Membro (customizável).",
    updatedAt: "2026-05-19",
    featured: true,
    content: `# Como convidar um membro pra equipe

Só **Admin** vê e usa essa funcionalidade. Membros não veem **/team**.

## Passo a passo

1. Vai em **/team** no sidebar
2. Na seção **Convidar novo membro**, preenche:
   * **Email** da pessoa
   * **Nível de acesso** (ver próxima seção)
3. Se escolheu **Personalizado**, expande **Seções (use só com Personalizado)** e marca quais o membro pode acessar
4. Clica **Criar acesso**

O hub:

1. Cria a conta no Supabase Auth com senha temporária aleatória
2. Adiciona o email no whitelist com o papel escolhido
3. **Dispara email automático** com Email + Senha + link de login
4. Mostra a senha **uma única vez** na tela como backup

## Níveis de acesso

| Nível | O que pode |
|---|---|
| **Admin** | Acesso total + gerencia equipe + vê auditoria + edita produtos/sistemas/conexões |
| **Membro (tudo)** | Acesso total exceto **/team** e **/audit** |
| **Membro (personalizado)** | Acesso só nas seções marcadas (ex: só **/sales** + **/customers**) |

## Editar acesso de um membro existente

1. Em **/team**, encontra a pessoa na lista
2. Clica **Editar acesso** (popover abre na direita)
3. Muda o nível ou marca/desmarca seções
4. Clica **Salvar**

Mudança vale no próximo refresh da página dele.

## Remover acesso

No mesmo popover de editar, clica **Remover** no rodapé.

Isso bloqueia o login imediatamente, mas a conta dele permanece no Supabase Auth (caso você queira re-convidar depois).

## Proteções automáticas

1. Você **não pode** rebaixar a si mesmo de Admin pra Membro
2. Você **não pode** se remover da lista
3. Toda mudança fica registrada em **/audit** (team.invite, team.update, team.remove)

## Quando o email não chega

O email pode cair em spam pro novo membro. Soluções:

1. Manda a senha no WhatsApp manualmente (aparece na tela após criar)
2. Pede pro membro marcar como **Não é spam** no Gmail dele
`,
  },

  {
    slug: "permissoes-granulares",
    title: "Permissões granulares (membro personalizado)",
    category: "equipe",
    summary: "Quando dar acesso só pra parte do sistema — e quais combinações fazem sentido.",
    updatedAt: "2026-05-22",
    content: `# Permissões granulares

Quando convidar como **Membro (personalizado)**, você escolhe quais seções a pessoa pode ver.

## Seções controláveis

| Seção | Path | Quem normalmente precisa |
|---|---|---|
| **Resumo** | / | Todo membro |
| **Aquisição** | /acquisition | Mídia, marketing |
| **Pesquisa** | /surveys | Comercial, mídia |
| **Vendas** | /sales | Comercial, financeiro |
| **Recuperação** | /recovery | Comercial |
| **Reembolsos** | /refunds | Financeiro, atendimento |
| **Assinaturas** | /subscriptions | Atendimento |
| **Clientes** | /customers | Comercial, atendimento |
| **Sistemas** | /systems | Quem cuida do SaaS |
| **Produtos** | /products | Quem cadastra ofertas |
| **Guias** | /guides | Todo membro |

## Seções **fechadas** (só Admin vê)

Independente da config, membro **nunca** vê:

* **/connections** (credenciais Assiny, Hotmart, Meta)
* **/webhooks** (URLs de saída)
* **/executions** (debug de webhook)
* **/team** (essa lista)
* **/audit** (logs de mudança)

## Combinações que fazem sentido

### Perfil "Comercial"
* Vendas, Clientes, Recuperação, Pesquisa, Assinaturas

### Perfil "Mídia / Marketing"
* Aquisição, Pesquisa, Vendas (read-only nas métricas)

### Perfil "Financeiro"
* Vendas, Reembolsos, Assinaturas

### Perfil "Atendimento ao cliente"
* Clientes, Assinaturas, Reembolsos

## Como mudar depois

A qualquer momento, em **/team** → **Editar acesso** → marca/desmarca seções → **Salvar**. Mudança aplica no próximo refresh do membro.

## Por que não tem "permissão de edição"

Hoje todas as seções são read-only OU all-or-nothing. Se o membro vê **/products**, ele consegue editar produto. Não tem "ver mas não editar".

Por enquanto, granularidade de **edição** é controlada por: admin = pode tudo, membro = só vê.
`,
  },

  // ─────────────────────────── INTEGRAÇÕES ───────────────────────────
  {
    slug: "conectar-assiny",
    title: "Conectando o Assiny ao hub",
    category: "integracoes",
    summary: "Configurar webhook do Assiny e validar que está chegando certo.",
    updatedAt: "2026-05-22",
    featured: true,
    content: `# Conectando o Assiny

O Assiny é o gateway principal pra assinaturas. Setup feito uma vez, depois é automático.

## URL do webhook

\`\`\`
https://hub-ga-webhooks.vercel.app/api/webhooks/assiny
\`\`\`

Quando \`webhooks.hubgeracaoa.com\` estiver com DNS configurado, vamos trocar pra:

\`\`\`
https://webhooks.hubgeracaoa.com/api/webhooks/assiny
\`\`\`

## Setup no Assiny

1. Acessa o painel Assiny da sua organização
2. Vai em **Configurações → Webhooks**
3. Click **Adicionar webhook**
4. Cola a URL acima
5. Marca todos os eventos abaixo
6. Salva

## Eventos que devem estar marcados

* \`approved_purchase\` — venda paga
* \`refund\` / \`request_refund\` — reembolso
* \`chargeback\` — chargeback
* \`subscription_renewed\` / \`renew\` — renovação
* \`subscription_cancelled\` — cancelamento
* \`pix_generated\` — PIX criado (entra em /recovery como aguardando)
* \`pix_expired\` — PIX venceu
* \`abandoned_checkout\` — carrinho abandonado

## Segredo HMAC

O Assiny manda um header \`X-Assiny-Signature\` com HMAC-SHA256 do body usando um secret compartilhado.

* Secret fica em \`ASSINY_WEBHOOK_SECRET\` no Vercel (env var)
* Hub valida via \`timingSafeEqual\`
* Falha de assinatura → execution com status \`rejected_auth\`

## Validar que está funcionando

1. Faz uma venda de teste no Assiny (R$ 1 funciona)
2. Vai em **/executions**
3. Procura pela execution mais recente
4. Status deve ser \`processed\` (verde)

Se aparecer \`rejected_auth\`: secret diferente entre painel Assiny e env var Vercel.

## Visualização das credenciais

Em **/connections** (só admin) → card Assiny → mostra status do secret.
`,
  },

  {
    slug: "conectar-hotmart",
    title: "Conectando o Hotmart ao hub",
    category: "integracoes",
    summary: "Hottok, URL do webhook e quais eventos ativar no painel Hotmart.",
    updatedAt: "2026-05-22",
    content: `# Conectando o Hotmart

Hotmart é gateway secundário (usado pra alguns produtos legacy + lançamentos pontuais).

## URL do webhook

\`\`\`
https://hub-ga-webhooks.vercel.app/api/webhooks/hotmart
\`\`\`

## Setup no Hotmart

1. Painel Hotmart → **Ferramentas → Webhook**
2. **Criar webhook**
3. Cola a URL
4. Aba **Autenticação** → copia o **Hottok** gerado
5. Cola no env var \`HOTMART_WEBHOOK_SECRET\` no Vercel
6. Marca os eventos abaixo

> ⚠️ Atenção: o Hottok da **aba Autenticação** é DIFERENTE do Hottok que aparece em Ferramentas → Webhook. Use o da aba Autenticação.

## Eventos pra marcar

* \`PURCHASE_APPROVED\` — venda paga
* \`PURCHASE_COMPLETE\` — pagamento confirmado
* \`PURCHASE_REFUNDED\` — reembolso
* \`PURCHASE_CHARGEBACK\` — chargeback
* \`PURCHASE_PROTEST\` — contestação
* \`PURCHASE_OUT_OF_SHOPPING_CART\` — carrinho abandonado
* \`PURCHASE_BILLET_PRINTED\` — boleto/PIX gerado
* \`PURCHASE_EXPIRED\` — venceu sem pagar
* \`PURCHASE_DELAYED\` — atrasou (assinatura)
* \`SUBSCRIPTION_CANCELLATION\` — cancelamento

## Como o hub valida

Hotmart manda header \`X-Hotmart-Hottok\` com o token estático. Hub compara com \`HOTMART_WEBHOOK_SECRET\` via \`timingSafeEqual\`.

## Validar que está funcionando

Mesmo processo do Assiny:

1. Venda de teste
2. **/executions**
3. Status esperado: \`processed\`

Se \`rejected_auth\` → Hottok no painel ≠ env var no Vercel.

## Visualização

**/connections** → card Hotmart → status do Hottok.
`,
  },

  {
    slug: "conectar-respondi",
    title: "Conectando o Respondi (pesquisa de qualificação)",
    category: "integracoes",
    summary: "Setup do webhook pra puxar respostas de formulários e qualificar leads.",
    updatedAt: "2026-05-22",
    content: `# Conectando o Respondi

Respondi é a ferramenta de pesquisa pra qualificar leads (A/B/C/D/E).

## URL única por conexão

A URL inclui um **secret aleatório** no path pra não precisar de HMAC:

\`\`\`
https://hub-ga-webhooks.vercel.app/api/webhooks/respondi/[SECRET]
\`\`\`

O \`[SECRET]\` é gerado quando você cria a conexão em **/connections → Respondi**.

## Setup no Respondi

1. Painel Respondi → **Formulário → Integrações**
2. **Adicionar webhook**
3. Cola a URL exata gerada pelo hub
4. Salva

## Eventos que importam

O Respondi manda **uma chamada por resposta**, independente do form. O hub:

1. Recebe payload com \`form.form_id\`, \`respondent.answers\`, \`respondent.respondent_utms\`
2. Extrai email/phone via heurística (pega qualquer campo de email ou telefone)
3. Procura cliente existente por email ou phone normalizado
4. Aplica as **regras de qualificação** configuradas em **/surveys/rules**
5. Insere em \`survey_responses\`

## Aplicação das regras

Pra cada regra ativa:

* Confere se o form_id bate (ou se a regra é Geral)
* Confere se a resposta de cada pergunta selecionada bate com o valor esperado
* Se TODAS as condições da regra batem → atribui a qualificação A/B/C/D/E

Múltiplas regras podem rodar — vence a primeira que casa (por ordem de criação).

## Validar

1. Submete uma resposta de teste no form Respondi
2. Vai em **/surveys**
3. A resposta aparece com qualificação calculada

## Filtros úteis em /surveys

* Por form
* Por qualificação (Tudo / A / B / C / D / E / não-qualificada)
* Período padrão
`,
  },

  {
    slug: "template-utm-meta-ads",
    title: "Template UTM padrão pra Meta Ads",
    category: "integracoes",
    summary: "Como configurar Parâmetros de URL no Meta pra atribuição automática funcionar.",
    updatedAt: "2026-05-27",
    featured: true,
    content: `# Template UTM padrão pra Meta Ads

Pra **atribuir vendas a campanhas/adsets/ads automaticamente** em /meta-ads, cada anúncio precisa ter UTMs configurados com **IDs do Meta** (não só nomes).

## Template recomendado

Cola **exatamente isso** em Ads Manager → escolhe o ad → **Editar** → **Opções de URL → Parâmetros de URL**:

\`\`\`
utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}
\`\`\`

> ⚠️ As chaves duplas \`{{ }}\` são **placeholders** que o Meta substitui em runtime. Não digite os IDs reais — deixa o Meta resolver.

## Por que esse formato

Formato \`name|id\` (nome + pipe + id) tem 2 vantagens:

1. **Match exato** no hub: o resolver extrai o id depois do \`|\` e usa pra encontrar a campanha
2. **Nome legível** em outras ferramentas (Google Analytics, planilhas, etc.)

## O que cada placeholder vira

| Placeholder | Substitui por | Exemplo |
|---|---|---|
| \`{{campaign.id}}\` | ID numérico da campanha | \`120211000123456789\` |
| \`{{campaign.name}}\` | Nome da campanha | \`[F01] Aquisição Geração A\` |
| \`{{adset.id}}\` | ID do conjunto | \`120211000234567890\` |
| \`{{adset.name}}\` | Nome do conjunto | \`Interesse 25-45\` |
| \`{{ad.id}}\` | ID do anúncio | \`120211000345678901\` |
| \`{{ad.name}}\` | Nome do anúncio | \`Headline A - vídeo\` |
| \`{{placement}}\` | Onde apareceu | \`facebook_reels\`, \`instagram_stories\`, \`facebook_feed\` |

URL final no clique:

\`\`\`
https://pay.assiny.com.br/funil-x?
  utm_source=FB
  &utm_campaign=[F01]%20Aquisi%C3%A7%C3%A3o%20Gera%C3%A7%C3%A3o%20A|120211000123456789
  &utm_medium=Interesse%2025-45|120211000234567890
  &utm_content=Headline%20A%20-%20v%C3%ADdeo|120211000345678901
  &utm_term=facebook_reels
\`\`\`

## Como o resolver usa (5 níveis)

| Nível | Match | Confiança |
|---|---|---|
| **1** | utm_content(id) + utm_medium(id) + utm_campaign(id) batem em (ad, adset, campaign) | **1.00** |
| 2 | só utm_content(id) bate em ad_id | 0.95 |
| 3 | utm_medium(id) + utm_campaign(id) batem em (adset, campaign) | 0.90 |
| 4 | utm_campaign(id) bate em campaign_id | 0.70 |
| 5 | utm_campaign(name) ilike campaign_name (fuzzy) | 0.40 |

Quanto mais alto o nível, mais confiável o ROAS atribuído.

## Aplicar em massa

No Meta Ads Manager dá pra editar vários ads de uma vez:

1. Vai em **Anúncios** (tab)
2. Filtra todos os ativos
3. Seleciona todos
4. Click **Editar** (lápis)
5. Em **Parâmetros de URL**, cola o template
6. **Aplicar a todos os selecionados**
7. Publicar

Próximas vendas vão começar a atribuir corretamente em /meta-ads.

## Verificar que tá funcionando

Roda no Supabase:

\`\`\`sql
select
  match_method,
  match_confidence,
  count(*) as total
from utm_sales_attribution
where matched = true
group by 1, 2
order by 2 desc;
\`\`\`

Se a maioria das vendas tá no nível **1.00** ou **0.95** = template tá aplicado. Se tá no **0.40** ou **0.70** = só algumas campanhas têm o template, completar nas outras.
`,
  },

  // ─────────────────────────── EMAILS ───────────────────────────
  {
    slug: "email-boas-vindas",
    title: "Email de boas-vindas (quando vende)",
    category: "emails",
    summary: "Quando dispara, o que contém, como personaliza por sistema.",
    updatedAt: "2026-05-22",
    featured: true,
    content: `# Email de boas-vindas

Disparado automaticamente pelo hub quando uma venda é processada com sucesso.

## Quando dispara

* Toda \`purchase.paid\` que **provisiona** algo (cria conta em SaaS)
* Um email **por sistema** que foi provisionado
* NÃO dispara em renovação (cliente já tem acesso)
* NÃO dispara se produto não tem entitlement (ex: só Cademí)

## O que tem dentro

Exemplo de conteúdo:

\`\`\`
Assunto: Sua senha do SCALO.AI

Olá [Nome],

Aqui estão seus dados de acesso ao SCALO.AI:

Email: [email do cliente]
Senha: mudarsenha123

Acesse: https://app.scalo.ai

Recomendamos trocar a senha após o primeiro login.

Geração A
\`\`\`

## Branding por sistema

Cada sistema tem **logo + cor de destaque** próprios (configurados em **/systems**):

| Sistema | Cor | Logo |
|---|---|---|
| SCALO.AI | Roxo | scalo-logo.png |
| BLACKBELT SWIPE | Preto/dourado | blackbelt-logo.png |
| GA SALES MACHINE | Verde | ga-sales-logo.png |

O email é renderizado com o branding do sistema correspondente.

## Versão texto/plano

Cada email tem versão **HTML** e **texto plano** (em paralelo). Email clients antigos mostram a versão texto, modernos mostram HTML. Aumenta a chance de não cair em spam.

## Senha temporária

Definida via env var \`DEFAULT_PROVISION_PASSWORD\` no Vercel. Hoje vale **\`mudarsenha123\`**.

> Pra trocar a senha padrão, basta atualizar a env var no Vercel. Novos provisionamentos vão usar a nova senha (provisionamentos antigos não mudam).

## Quando o email não chega

1. Confere **/customers/[id]** → tab "Provisionamentos" → status do grant
2. Se \`status: created\` mas cliente diz que não recebeu → spam folder
3. Se \`status: failed\` → lê \`error_message\` (geralmente API do SaaS fora)

## Reenviar manualmente

Hoje não há botão "Reenviar email" no hub. Workaround: manda senha por WhatsApp.
`,
  },

  {
    slug: "email-convite-equipe",
    title: "Email de convite de membro",
    category: "emails",
    summary: "O que o membro recebe quando você cria acesso pra ele em /team.",
    updatedAt: "2026-05-22",
    content: `# Email de convite de membro

Disparado quando você adiciona alguém em **/team**.

## Conteúdo

\`\`\`
Assunto: Bem-vindo(a) ao Hub Geração A

Olá!

Você foi convidado(a) pra acessar o Hub Geração A.

Email: [email]
Senha temporária: [senha aleatória gerada]

Acesse: https://hubgeracaoa.com

Recomendamos trocar a senha após o primeiro login (Perfil → Editar senha).

Equipe Geração A
\`\`\`

## Diferença pro email de boas-vindas (venda)

| Aspecto | Boas-vindas | Convite |
|---|---|---|
| Quando dispara | Venda de produto SaaS | Admin adiciona em /team |
| Senha | Padrão (\`mudarsenha123\`) | Aleatória gerada na hora |
| Branding | Cor do sistema vendido | Hub Geração A (rosa) |
| Reset | Não tem botão "reenviar" | Não tem botão "reenviar" |

## Backup: senha na tela

Quando você cria o acesso em **/team**, a senha aleatória aparece **uma única vez** na tela. Anote ou copie pro WhatsApp do membro caso o email caia em spam.

Depois de fechar a tela, a senha **não** pode ser recuperada — só resetada via Supabase Auth admin.

## Quando o email cai em spam

Mais comum em Gmail novo:
1. Pede pro membro marcar como **Não é spam**
2. Adicione \`noreply@hubgeracaoa.com\` aos contatos do Gmail dele
3. Se persistir, envia a senha manualmente (não cause problema, ela vai expirar quando ele trocar)
`,
  },
];

export function getGuidesByCategory(): Array<{ category: GuideCategory; guides: Guide[] }> {
  const map = new Map<GuideCategory, Guide[]>();
  for (const g of GUIDES) {
    if (!map.has(g.category)) map.set(g.category, []);
    map.get(g.category)!.push(g);
  }
  return CATEGORY_ORDER.filter((c) => map.has(c)).map((category) => ({
    category,
    guides: (map.get(category) ?? []).sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
  }));
}

export function findGuide(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}

/**
 * Calcula tempo de leitura estimado em minutos baseado no conteúdo.
 * Considera ~200 palavras/min (média de leitura técnica em PT-BR).
 */
export function estimateReadMinutes(content: string): number {
  const words = content.trim().split(/\s+/).length;
  const min = Math.max(1, Math.round(words / 200));
  return min;
}

/**
 * Retorna guia anterior e próximo no mesmo grupo de categorias
 * (ordem fixa por CATEGORY_ORDER + título alfabético dentro da categoria).
 */
export function getAdjacentGuides(slug: string): { prev: Guide | null; next: Guide | null } {
  const flat: Guide[] = [];
  for (const cat of CATEGORY_ORDER) {
    const inCat = GUIDES.filter((g) => g.category === cat).sort((a, b) =>
      a.title.localeCompare(b.title, "pt-BR"),
    );
    flat.push(...inCat);
  }
  const idx = flat.findIndex((g) => g.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] ?? null : null,
    next: idx < flat.length - 1 ? flat[idx + 1] ?? null : null,
  };
}

/**
 * Considera "novo" se updatedAt < 30 dias atrás.
 */
export function isRecent(updatedAt: string): boolean {
  const t = new Date(updatedAt + "T03:00:00.000Z").getTime();
  return Date.now() - t < 30 * 24 * 60 * 60 * 1000;
}
