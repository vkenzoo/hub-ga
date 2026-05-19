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
}

export const GUIDES: Guide[] = [
  {
    slug: "fluxo-de-uma-venda",
    title: "O que acontece quando uma venda chega",
    category: "operacao",
    summary: "Linha do tempo completa desde o webhook até o cliente receber o acesso.",
    updatedAt: "2026-05-19",
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
    slug: "cadastrar-produto",
    title: "Como cadastrar um produto novo",
    category: "produtos",
    summary: "Passo a passo pra ligar produto do Assiny/Hotmart ao hub e liberar acesso automático.",
    updatedAt: "2026-05-19",
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
    slug: "convidar-membro",
    title: "Como convidar um membro pra equipe",
    category: "equipe",
    summary: "Cria acesso ao hub pra outras pessoas com nível Admin ou Membro (customizável).",
    updatedAt: "2026-05-19",
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
