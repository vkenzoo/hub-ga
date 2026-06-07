import { z } from "zod";

/**
 * Schema do payload REAL do Assiny (descoberto via debug em produção).
 *
 * Estrutura observada:
 *   {
 *     event: "approved_purchase",
 *     data: { offer, subscription, order_bumps },
 *     transaction: {...},  // top-level, NÃO dentro de data
 *     client: {...},        // top-level, campo "client" (não "customer"!)
 *     metadata: {...}       // top-level — UTMs aqui
 *   }
 *
 * Doc: https://assiny.gitbook.io/assiny-docs/webhooks/payloads
 */

// NOTA: usamos .nullish() (= optional + nullable) em vez de .optional() porque o
// Assiny manda null EXPLÍCITO em campos ausentes (ex: offer.recurrence: null em
// compra one-time, client.address: null sem endereço). .optional() rejeitaria
// null e o webhook viraria "invalid_payload" — visto em produção 31/05/2026
// (tx 93fdb10b-8362-4ea7-8e56-b6c0903d5287, ofertra UPSELL recurrence=null).
const assinyClientSchema = z
  .object({
    email: z.string().nullish(),
    full_name: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    phone: z.string().nullish(),
    document: z.string().nullish(),
  })
  .passthrough();

// Cada order_bump é um produto extra comprado no mesmo checkout que o main.
// Tem product/amount próprios. Vira purchase separada no hub.
const assinyOrderBumpSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().nullish(),
    amount_with_tax: z.union([z.string(), z.number()]).nullish(),
    amount_client: z.union([z.string(), z.number()]).nullish(),
    product_price: z.union([z.string(), z.number()]).nullish(),
    type: z.string().nullish(),
    checkout_type: z.string().nullish(),
    payment_type: z.string().nullish(),
    recurrence: z.string().nullish(),
    product: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).nullish(),
        name: z.string().nullish(),
        producer_name: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    subscription: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).nullish(),
        recurrence: z.string().nullish(),
        cycle: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const assinyOfferSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().nullish(),
    amount: z.union([z.string(), z.number()]).nullish(),
    amount_client: z.union([z.string(), z.number()]).nullish(), // líquido do produtor (sem taxa)
    recurrence: z.string().nullish(),
    type: z.string().nullish(),
    product: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).nullish(),
        name: z.string().nullish(),
        producer_name: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    order_bumps: z.array(assinyOrderBumpSchema).nullish(),
  })
  .passthrough();

const assinySubscriptionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).nullish(),
    recurrence: z.string().nullish(),
    cycle: z.number().nullish(),
    is_subscription_renew: z.boolean().nullish(),
    next_billing_date: z.string().nullish(),
    current_period_end: z.string().nullish(),
  })
  .passthrough();

const assinyTransactionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).nullish(),
    amount: z.union([z.string(), z.number()]).nullish(),
    net_amount: z.union([z.string(), z.number()]).nullish(), // líquido (sem taxa Assiny)
    status: z.string().nullish(),
    payment_type: z.string().nullish(),
    cycle: z.number().nullish(),
    commissions: z
      .array(
        z
          .object({
            user: z.union([z.string(), z.number(), z.object({}).passthrough()]).nullish(),
            email: z.string().nullish(),
            amount: z.union([z.string(), z.number()]).nullish(),
            type: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

const assinyMetadataSchema = z
  .object({
    utm_source: z.string().nullish(),
    utm_medium: z.string().nullish(),
    utm_campaign: z.string().nullish(),
    utm_content: z.string().nullish(),
    utm_term: z.string().nullish(),
    funnel_id: z.string().nullish(),
    short_funnel_id: z.string().nullish(),
    node_id: z.string().nullish(),
    ip: z.string().nullish(),
    user_agent: z.string().nullish(),
    url_parameters: z.record(z.unknown()).nullish(),
    event_source_url: z.string().nullish(),
  })
  .passthrough();

// Schema flexível: aceita transaction/metadata tanto em data.* quanto no top-level.
// Eventos de teste vinham top-level; eventos reais (conforme doc) vêm dentro de data.
export const assinyEventSchema = z
  .object({
    event: z.string().min(1),
    data: z
      .object({
        offer: assinyOfferSchema.optional(),
        subscription: assinySubscriptionSchema.optional(),
        order_bumps: z.array(z.unknown()).optional(),
        transaction: assinyTransactionSchema.optional(),
        metadata: assinyMetadataSchema.optional(),
        client: assinyClientSchema.optional(),
      })
      .passthrough(),
    transaction: assinyTransactionSchema.optional(),
    client: assinyClientSchema.optional(),
    metadata: assinyMetadataSchema.optional(),
  })
  .passthrough();

export type AssinyEvent = z.infer<typeof assinyEventSchema>;

/**
 * Extrai ID único do evento pra dedupe.
 *
 * BUG RESOLVIDO: Assiny manda transaction em `data.transaction.id` (payload novo),
 * mas o código antigo só lia `e.transaction?.id` (top-level). Quando vinha vazio,
 * caía no fallback `email_offer_event`, e MÚLTIPLAS vendas da mesma oferta sem
 * email top-level (também ausente no payload novo) ficavam com MESMO id →
 * todas exceto a primeira eram dedup'das como duplicate.
 *
 * Fix: lê data.transaction.id PRIMEIRO (novo), fallback pro top-level (legado).
 * Mesma coisa pra client.email e offer.id.
 */
export function extractGatewayEventId(e: AssinyEvent): string {
  const txId = e.data.transaction?.id ?? e.transaction?.id;
  const subId = e.data.subscription?.id;
  const cycle = e.data.subscription?.cycle;
  const email = e.data.client?.email ?? e.client?.email;
  const offerId = e.data.offer?.id;

  if (e.event.includes("renew") || (cycle && cycle > 1)) {
    return `${subId}_${cycle ?? 0}_${e.event}`;
  }
  if (txId) return `${txId}_${e.event}`;
  return `${email ?? "?"}_${offerId ?? "?"}_${e.event}`;
}
