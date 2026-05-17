import { z } from "zod";

/**
 * Schema do payload real do Assiny (descoberto via debug em produção).
 * Formato observado:
 *   { event: "approved_purchase", data: { ...transaction, customer, offer, product, ... } }
 *
 * Doc: https://assiny.gitbook.io/assiny-docs/webhooks/payloads
 * Eventos conhecidos:
 *   approved_purchase, completed_purchase, refunded_purchase,
 *   refused_purchase, chargeback, refund_requested,
 *   boleto_gerado, pix_gerado, pix_expirado, abandoned_cart
 */

const assinyCustomerSchema = z
  .object({
    // Email pode vir vazio em eventos de teste — validamos no handler.
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
  })
  .passthrough();

const assinyProductSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    name: z.string().optional(),
  })
  .passthrough();

const assinySubscriptionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    plan_id: z.union([z.string(), z.number()]).transform(String).optional(),
    recurrence: z.string().optional(),
    cycle: z.number().optional(),
    next_billing_date: z.string().optional(),
    current_period_end: z.string().optional(),
  })
  .passthrough();

const assinyMetadataSchema = z
  .object({
    url_parameters: z
      .object({
        utm_source: z.string().optional(),
        utm_medium: z.string().optional(),
        utm_campaign: z.string().optional(),
        utm_content: z.string().optional(),
        utm_term: z.string().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .passthrough();

const assinyTransactionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    code: z.string().optional(),
    commissions: z
      .array(
        z
          .object({
            amount: z.union([z.string(), z.number()]).optional(),
            user: z
              .object({ id: z.union([z.string(), z.number()]).optional(), name: z.string().optional() })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export const assinyEventSchema = z
  .object({
    event: z.string().min(1),
    data: z
      .object({
        status: z.string().optional(),
        amount: z.union([z.string(), z.number()]).optional(),
        amount_with_tax: z.union([z.string(), z.number()]).optional(),
        customer: assinyCustomerSchema.optional(),
        offer: assinyOfferSchema.optional(),
        product: assinyProductSchema.optional(),
        subscription: assinySubscriptionSchema.optional(),
        transaction: assinyTransactionSchema.optional(),
        metadata: assinyMetadataSchema.optional(),
        payment_type: z.string().optional(),
        // ID único do evento — usar pra dedupe. Pode estar em diferentes lugares
        // dependendo do tipo do evento. Tentamos vários.
        id: z.union([z.string(), z.number()]).transform(String).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type AssinyEvent = z.infer<typeof assinyEventSchema>;

/**
 * Extrai um ID estável pra dedupe (gateway_event_id).
 * O Assiny não tem um campo padrão único — combina transaction.id ou
 * subscription.id + status pra ter chave estável.
 */
export function extractGatewayEventId(e: AssinyEvent): string {
  const d = e.data;
  const txId = d.transaction?.id || d.transaction?.code;
  const subId = d.subscription?.id;
  const cycle = d.subscription?.cycle;
  // Eventos de assinatura recorrente: usa sub_id + cycle pra deduplicar renovações
  if (e.event.includes("renew") || e.event.includes("recur")) {
    return `${subId}_${cycle ?? 0}_${e.event}`;
  }
  // Transações normais: tx_id
  if (txId) return `${txId}_${e.event}`;
  // Fallback: usa o id direto do data se houver
  if (d.id) return `${d.id}_${e.event}`;
  // Último recurso: customer email + offer id + status (não dá pra evitar reprocessamento)
  return `${d.customer.email}_${d.offer?.id ?? "?"}_${d.status ?? e.event}`;
}
