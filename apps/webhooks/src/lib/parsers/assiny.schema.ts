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
 */
export function extractGatewayEventId(e: AssinyEvent): string {
  const txId = e.transaction?.id;
  const subId = e.data.subscription?.id;
  const cycle = e.data.subscription?.cycle;
  if (e.event.includes("renew") || (cycle && cycle > 1)) {
    return `${subId}_${cycle ?? 0}_${e.event}`;
  }
  if (txId) return `${txId}_${e.event}`;
  return `${e.client?.email ?? "?"}_${e.data.offer?.id ?? "?"}_${e.event}`;
}
