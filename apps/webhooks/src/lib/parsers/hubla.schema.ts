import { z } from "zod";

/**
 * Schema do webhook v2 da Hubla.
 *
 * Envelope: { type, event, version }
 *   - type    → identifica o evento (ex: "invoice.payment_succeeded")
 *   - event   → { product, products[], invoice, subscription, user }
 *   - version → "2.0.0"
 *
 * Valores monetários em CENTAVOS (dividir por 100).
 * Doc: https://hubla.gitbook.io/docs/webhooks/eventos-v2
 *
 * Usamos .nullish() (optional + nullable) porque a Hubla pode mandar null
 * explícito em campos ausentes.
 */

const hublaPersonSchema = z
  .object({
    id: z.string().nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    document: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
  })
  .passthrough();

const hublaOfferSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string().nullish(),
  })
  .passthrough();

const hublaProductSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    offers: z.array(hublaOfferSchema).nullish(),
  })
  .passthrough();

const hublaAmountSchema = z
  .object({
    subtotalCents: z.number().nullish(),
    discountCents: z.number().nullish(),
    prorataCents: z.number().nullish(),
    installmentFeeCents: z.number().nullish(),
    totalCents: z.number().nullish(),
  })
  .passthrough();

const hublaReceiverSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    role: z.string().nullish(), // "platform" | "seller" | "affiliate" | ...
    totalCents: z.number().nullish(),
  })
  .passthrough();

const hublaUtmSchema = z
  .object({
    source: z.string().nullish(),
    medium: z.string().nullish(),
    campaign: z.string().nullish(),
    content: z.string().nullish(),
    term: z.string().nullish(),
  })
  .passthrough();

const hublaInvoiceSchema = z
  .object({
    id: z.string(),
    subscriptionId: z.string().nullish(),
    sellerId: z.string().nullish(),
    payerId: z.string().nullish(),
    payer: hublaPersonSchema.nullish(),
    installments: z.number().nullish(),
    paymentMethod: z.string().nullish(), // "credit_card" | "pix" | "bank_slip"
    currency: z.string().nullish(),
    type: z.string().nullish(), // "sell" | ...
    status: z.string().nullish(),
    amount: hublaAmountSchema.nullish(),
    receivers: z.array(hublaReceiverSchema).nullish(),
    firstPaymentSession: z
      .object({ ip: z.string().nullish(), utm: hublaUtmSchema.nullish() })
      .passthrough()
      .nullish(),
    saleDate: z.string().nullish(),
    dueDate: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .passthrough();

const hublaSubscriptionSchema = z
  .object({
    id: z.string().nullish(),
    status: z.string().nullish(),
    autoRenew: z.boolean().nullish(),
    credits: z.number().nullish(),
    cycle: z.number().nullish(),
    currentPeriodEnd: z.string().nullish(),
    nextBillingDate: z.string().nullish(),
  })
  .passthrough();

export const hublaEventSchema = z
  .object({
    type: z.string().min(1),
    version: z.string().nullish(),
    event: z
      .object({
        product: hublaProductSchema.nullish(),
        products: z.array(hublaProductSchema).nullish(),
        invoice: hublaInvoiceSchema.nullish(),
        subscription: hublaSubscriptionSchema.nullish(),
        user: hublaPersonSchema.nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type HublaEvent = z.infer<typeof hublaEventSchema>;

/**
 * ID único do evento pra dedupe. A Hubla identifica a transação pela invoice.id
 * (que é ESTÁVEL entre payment_succeeded e refunded da mesma fatura). Sufixo com
 * o `type` pra permitir estados diferentes da mesma fatura.
 */
export function extractGatewayEventId(e: HublaEvent): string {
  const invId = e.event.invoice?.id;
  const subId = e.event.subscription?.id ?? e.event.invoice?.subscriptionId;
  const userId = e.event.user?.id ?? e.event.invoice?.payer?.id;
  const base = invId ?? subId ?? userId ?? "unknown";
  return `${base}_${e.type}`;
}
