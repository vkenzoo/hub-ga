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

const assinyClientSchema = z
  .object({
    email: z.string().optional(),
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    document: z.string().optional(),
  })
  .passthrough();

// Cada order_bump é um produto extra comprado no mesmo checkout que o main.
// Tem product/amount próprios. Vira purchase separada no hub.
const assinyOrderBumpSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().optional(),
    amount_with_tax: z.union([z.string(), z.number()]).optional(),
    amount_client: z.union([z.string(), z.number()]).optional(),
    product_price: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
    checkout_type: z.string().optional(),
    payment_type: z.string().optional(),
    recurrence: z.string().optional(),
    product: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).optional(),
        name: z.string().optional(),
        producer_name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    subscription: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).optional(),
        recurrence: z.string().optional(),
        cycle: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const assinyOfferSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    recurrence: z.string().optional(),
    type: z.string().optional(),
    product: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).optional(),
        name: z.string().optional(),
        producer_name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    order_bumps: z.array(assinyOrderBumpSchema).optional(),
  })
  .passthrough();

const assinySubscriptionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    recurrence: z.string().optional(),
    cycle: z.number().optional(),
    is_subscription_renew: z.boolean().optional(),
    next_billing_date: z.string().optional(),
    current_period_end: z.string().optional(),
  })
  .passthrough();

const assinyTransactionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    payment_type: z.string().optional(),
    cycle: z.number().optional(),
    commissions: z
      .array(
        z
          .object({
            user: z.union([z.string(), z.number(), z.object({}).passthrough()]).optional(),
            email: z.string().optional(),
            amount: z.union([z.string(), z.number()]).optional(),
            type: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const assinyMetadataSchema = z
  .object({
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
    utm_term: z.string().optional(),
    funnel_id: z.string().optional(),
    short_funnel_id: z.string().optional(),
    node_id: z.string().optional(),
    ip: z.string().optional(),
    user_agent: z.string().optional(),
    url_parameters: z.record(z.unknown()).optional(),
    event_source_url: z.string().optional(),
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
