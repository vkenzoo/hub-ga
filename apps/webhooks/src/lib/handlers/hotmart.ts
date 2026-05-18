import type { SupabaseClient } from "@supabase/supabase-js";
import type { HotmartEvent } from "../parsers/hotmart.schema";
import {
  recordPurchase,
  handleSubscriptionStatusEvent,
  type NormalizedPurchase,
  type PurchaseStatus,
  type EventKind,
} from "./shared";
import { logEvent } from "../logger";

/**
 * Eventos comuns do Hotmart 2.0 incluem:
 *  PURCHASE_APPROVED, PURCHASE_COMPLETE, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK,
 *  PURCHASE_DELAYED, PURCHASE_PROTEST,
 *  SUBSCRIPTION_CANCELLATION, PURCHASE_EXPIRED (renovação não paga),
 *  SUBSCRIPTION_REACTIVATED, etc.
 * Faço uma classificação por palavra-chave pra cobrir variações.
 */
function classifyHotmartEvent(eventName: string, rawStatus?: string): EventKind | "unknown" {
  const t = `${eventName} ${rawStatus ?? ""}`.toLowerCase();

  if (t.includes("refund")) return "purchase_refunded";
  if (t.includes("chargeback") || t.includes("protest")) return "purchase_chargeback";

  const isSub = t.includes("subscription") || t.includes("assinatur");
  if (
    (isSub && (t.includes("cancel") || t.includes("revok"))) ||
    t.includes("subscription_cancellation")
  ) {
    return "subscription_cancelled";
  }
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
  const kind = classifyHotmartEvent(event.event, d.purchase?.status);

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

  const purchaseAny = d.purchase as Record<string, unknown>;
  const paymentObj = purchaseAny.payment as { type?: string; method?: string } | undefined;

  const normalized: NormalizedPurchase = {
    gateway: "hotmart",
    eventKind: kind,
    gatewayEventId: event.id,
    gatewayProductId: d.product.id,
    productNameHint: d.product.name,
    paymentMethod: paymentObj?.type ?? paymentObj?.method ?? undefined,
    customer: {
      email: d.buyer.email,
      name: d.buyer.name,
      phone: d.buyer.phone,
    },
    amount: d.purchase.price?.value ?? 0,
    status: mapPurchaseStatus(kind),
    utm: {
      source: tracking.source,
      content: tracking.source_sck,
      campaign: tracking.external_code,
    },
    affiliateId: affiliateCode,
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
