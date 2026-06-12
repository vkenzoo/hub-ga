import type { SupabaseClient } from "@supabase/supabase-js";
import type { HotmartEvent } from "../parsers/hotmart.schema";
import {
  recordPurchase,
  recordLostPurchase,
  handleSubscriptionStatusEvent,
  type NormalizedPurchase,
  type NormalizedLostPurchase,
  type LostKind,
  type PurchaseStatus,
  type EventKind,
} from "./shared";
import { logEvent } from "../logger";

/**
 * Eventos comuns do Hotmart 2.0 incluem:
 *  PURCHASE_APPROVED, PURCHASE_COMPLETE, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK,
 *  PURCHASE_DELAYED, PURCHASE_PROTEST,
 *  PURCHASE_OUT_OF_SHOPPING_CART (carrinho abandonado),
 *  PURCHASE_BILLET_PRINTED (PIX/boleto gerado, esperando pagamento),
 *  SUBSCRIPTION_CANCELLATION, PURCHASE_EXPIRED (renovação não paga OU venda nova expirada),
 *  SUBSCRIPTION_REACTIVATED, etc.
 * Faço uma classificação por palavra-chave pra cobrir variações.
 *
 * Retorna "lost:<kind>" pra eventos de venda perdida.
 */
function classifyHotmartEvent(
  eventName: string,
  rawStatus?: string,
): EventKind | `lost:${LostKind}` | "unknown" {
  const t = `${eventName} ${rawStatus ?? ""}`.toLowerCase();

  if (t.includes("refund")) return "purchase_refunded";
  if (t.includes("chargeback") || t.includes("protest")) return "purchase_chargeback";

  // Carrinho abandonado: PURCHASE_OUT_OF_SHOPPING_CART
  if (t.includes("out_of_shopping_cart") || t.includes("abandon")) {
    return "lost:cart_abandoned";
  }
  // Boleto/PIX impresso (esperando pagamento): PURCHASE_BILLET_PRINTED
  // Decisão entre pix_pending vs billet_pending fica pro handler (olha payment.type).
  if (t.includes("billet_printed") || t.includes("pix_generated")) {
    return "lost:pix_pending";  // será refinado no handler
  }

  const isSub = t.includes("subscription") || t.includes("assinatur");
  if (
    (isSub && (t.includes("cancel") || t.includes("revok"))) ||
    t.includes("subscription_cancellation")
  ) {
    return "subscription_cancelled";
  }
  // PURCHASE_EXPIRED é ambíguo (renovação OU venda nova). Mantemos como past_due
  // por compat. O handler refina se subscriber.code estiver ausente.
  if (t.includes("delayed") || t.includes("expired") || t.includes("past_due") || t.includes("overdue")) {
    return "subscription_past_due";
  }
  if (isSub && (t.includes("renew") || t.includes("reactivat") || t.includes("billed"))) {
    return "subscription_renewed";
  }

  if (t.includes("approved") || t.includes("complete") || t.includes("paid")) {
    return "purchase_paid";
  }

  return "unknown";
}

function mapPurchaseStatus(kind: EventKind): PurchaseStatus {
  if (kind === "purchase_refunded") return "refunded";
  if (kind === "purchase_chargeback") return "chargeback";
  return "paid";
}

export async function handleHotmartEvent(hub: SupabaseClient, event: HotmartEvent) {
  const d = event.data;
  let kind = classifyHotmartEvent(event.event, d.purchase?.status);

  // Refino: PURCHASE_EXPIRED sem subscription existente → venda nova perdida
  // Hotmart usa PURCHASE_EXPIRED tanto pra renovação não paga quanto venda nova.
  // Se não tem subscriber.code, é venda nova → routear pra lost.
  if (kind === "subscription_past_due" && event.event.toLowerCase().includes("expired") && !d.subscription?.subscriber?.code) {
    const pType = (d.purchase?.payment as { type?: string } | undefined)?.type?.toLowerCase() ?? "";
    kind = pType.includes("billet") || pType.includes("boleto") ? "lost:billet_expired" : "lost:pix_expired";
  }

  await logEvent(hub, "webhook.received", {
    level: kind === "unknown" ? "warn" : "info",
    payload: {
      gateway: "hotmart",
      raw_event_type: event.event,
      raw_status: d.purchase?.status ?? null,
      classified_as: kind,
      gateway_event_id: event.id,
    },
  });

  if (kind === "unknown") {
    return { skipped: true as const, reason: "unknown_event_kind" };
  }

  // Rota especial: vendas perdidas
  if (typeof kind === "string" && kind.startsWith("lost:")) {
    return handleHotmartLostEvent(hub, event, kind.slice(5) as LostKind);
  }

  // Status-only events na assinatura
  if (kind === "subscription_past_due" || kind === "subscription_cancelled") {
    const subId = d.subscription?.subscriber?.code;
    if (!subId) {
      return { skipped: true as const, reason: "missing_subscription_id" };
    }
    return handleSubscriptionStatusEvent(hub, {
      gateway: "hotmart",
      gatewayEventId: event.id,
      gatewaySubscriptionId: subId,
      newStatus: kind === "subscription_past_due" ? "past_due" : "cancelled",
      currentPeriodEnd: d.subscription?.date_next_charge
        ? new Date(d.subscription.date_next_charge).toISOString()
        : null,
    });
  }

  // Eventos com transação (precisa de purchase data)
  if (!d.purchase) {
    return { skipped: true as const, reason: "missing_purchase" };
  }

  const tracking = d.purchase.tracking ?? {};
  const affiliateCode = d.affiliates?.[0]?.affiliate_code;
  const affiliateName = d.affiliates?.[0]?.name;

  // Receita líquida real = comissão do PRODUCER. SÓ aplica em venda de AFILIADO
  // (aí o afiliado fica com uma parte e você recebe menos). Em venda direta
  // (sem afiliado) a receita é o valor cheio → netAmount fica undefined e o
  // dashboard usa amount. Sem commissions também cai no fallback (amount).
  const producerCommission = affiliateCode
    ? d.commissions?.find((c) => (c.source ?? "").toUpperCase() === "PRODUCER")?.value
    : undefined;

  const purchaseAny = d.purchase as Record<string, unknown>;
  const paymentObj = purchaseAny.payment as { type?: string; method?: string } | undefined;

  const eventKind = kind as EventKind;

  // Horário REAL da transação. Hotmart envia em purchase.order_date (epoch ms)
  // ou approved_date. Importante pra replay não marcar com NOW().
  const occurredEpoch =
    (d.purchase as { approved_date?: number; order_date?: number }).approved_date ??
    (d.purchase as { order_date?: number }).order_date;
  const occurredAt =
    occurredEpoch && Number.isFinite(occurredEpoch)
      ? new Date(occurredEpoch).toISOString()
      : undefined;

  const normalized: NormalizedPurchase = {
    gateway: "hotmart",
    eventKind,
    gatewayEventId: event.id,
    txExternalId: d.purchase.transaction,
    gatewayProductId: d.product.id,
    productNameHint: d.product.name,
    paymentMethod: paymentObj?.type ?? paymentObj?.method ?? undefined,
    occurredAt,
    // Hotmart não envia número do ciclo explícito — quando é renovação inferimos cycle>=2.
    subscriptionCycle: eventKind === "subscription_renewed" ? 2 : eventKind === "purchase_paid" ? 1 : undefined,
    customer: {
      email: d.buyer.email,
      name: d.buyer.name,
      phone: d.buyer.phone,
    },
    amount: d.purchase.price?.value ?? 0,
    status: mapPurchaseStatus(eventKind),
    utm: {
      source: tracking.source,
      content: tracking.source_sck,
      campaign: tracking.external_code,
    },
    affiliateId: affiliateCode,
    affiliateName: affiliateName,
    netAmount: typeof producerCommission === "number" && Number.isFinite(producerCommission)
      ? producerCommission
      : undefined,
    subscription: d.subscription?.subscriber?.code
      ? {
          gatewaySubscriptionId: d.subscription.subscriber.code,
          currentPeriodEnd: d.subscription.date_next_charge
            ? new Date(d.subscription.date_next_charge).toISOString()
            : null,
        }
      : undefined,
  };
  return recordPurchase(hub, normalized);
}

/**
 * Trata eventos de venda perdida do Hotmart:
 *   - PURCHASE_OUT_OF_SHOPPING_CART → cart_abandoned (sem transaction)
 *   - PURCHASE_BILLET_PRINTED       → pix_pending / billet_pending (refina por payment.type)
 *   - PURCHASE_EXPIRED (sem sub)    → pix_expired / billet_expired
 */
async function handleHotmartLostEvent(
  hub: SupabaseClient,
  event: HotmartEvent,
  lostKindHint: LostKind,
) {
  const d = event.data;
  const purchaseAny = d.purchase as Record<string, unknown> | undefined;
  const paymentObj = purchaseAny?.payment as { type?: string; method?: string } | undefined;
  const pType = (paymentObj?.type ?? paymentObj?.method ?? "").toLowerCase();
  const isBillet = pType.includes("billet") || pType.includes("boleto");

  // Refina pix_pending → billet_pending se for boleto
  let lostKind: LostKind = lostKindHint;
  if (lostKind === "pix_pending" && isBillet) lostKind = "billet_pending";
  if (lostKind === "pix_expired" && isBillet) lostKind = "billet_expired";

  // External event ID: tx do purchase quando existe, senão event.id (cart_abandoned não tem tx)
  const txId = d.purchase?.transaction;
  const externalEventId = txId ?? event.id;

  const tracking = d.purchase?.tracking ?? {};
  const utm = {
    source: tracking.source,
    content: tracking.source_sck,
    campaign: tracking.external_code,
  };

  const lp: NormalizedLostPurchase = {
    platform: "hotmart",
    kind: lostKind,
    externalEventId,
    email: d.buyer.email,
    phone: d.buyer.phone,
    productGatewayId: d.product.id,
    productNameHint: d.product.name,
    amountCents: d.purchase?.price?.value ?? 0,
    utm,
    paymentMethod: paymentObj?.type ?? paymentObj?.method,
    occurredAt: new Date().toISOString(),
    rawPayload: event,
  };

  return recordLostPurchase(hub, lp);
}
