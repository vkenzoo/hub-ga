import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssinyEvent } from "../parsers/assiny.schema";
import {
  recordPurchase,
  handleSubscriptionStatusEvent,
  type NormalizedPurchase,
  type PurchaseStatus,
  type EventKind,
} from "./shared";
import { logEvent } from "../logger";

/**
 * Classifica o event_type do Assiny em um EventKind canônico.
 * Tolerante a variações de nome ("purchase.paid", "PAYMENT_APPROVED", etc).
 */
function classifyAssinyEvent(eventType: string, rawStatus?: string): EventKind | "unknown" {
  const t = `${eventType} ${rawStatus ?? ""}`.toLowerCase();

  if (t.includes("refund")) return "purchase_refunded";
  if (t.includes("chargeback")) return "purchase_chargeback";

  // Subscription-only events (sem nova transação)
  const isSub = t.includes("subscription") || t.includes("assinatur");
  if (isSub && (t.includes("past_due") || t.includes("overdue") || t.includes("failed") || t.includes("atras"))) {
    return "subscription_past_due";
  }
  if (isSub && (t.includes("cancel") || t.includes("revok"))) {
    return "subscription_cancelled";
  }

  // Renovação: tem nova cobrança, mas é diferente da 1ª compra
  if (isSub && (t.includes("renew") || t.includes("billed") || t.includes("recurring") || t.includes("charged"))) {
    return "subscription_renewed";
  }

  // Compra aprovada
  if (t.includes("paid") || t.includes("approved") || t.includes("completed") || t.includes("success")) {
    return "purchase_paid";
  }

  return "unknown";
}

function mapPurchaseStatus(kind: EventKind): PurchaseStatus {
  if (kind === "purchase_refunded") return "refunded";
  if (kind === "purchase_chargeback") return "chargeback";
  return "paid"; // purchase_paid e subscription_renewed gravam como "paid"
}

export async function handleAssinyEvent(hub: SupabaseClient, event: AssinyEvent) {
  const kind = classifyAssinyEvent(event.event_type, event.status);

  // Log do "tradutor": event_type bruto → kind classificado.
  // Permite auditar e ajustar o classifyAssinyEvent quando aparecer um nome novo.
  await logEvent(hub, "webhook.received", {
    level: kind === "unknown" ? "warn" : "info",
    payload: {
      gateway: "assiny",
      raw_event_type: event.event_type,
      raw_status: event.status ?? null,
      classified_as: kind,
      gateway_event_id: event.event_id,
    },
  });

  if (kind === "unknown") {
    return { skipped: true as const, reason: "unknown_event_kind" };
  }

  // Eventos que NÃO geram nova transação — só mudam status da assinatura
  if (kind === "subscription_past_due" || kind === "subscription_cancelled") {
    if (!event.subscription_id) {
      return { skipped: true as const, reason: "missing_subscription_id" };
    }
    return handleSubscriptionStatusEvent(hub, {
      gateway: "assiny",
      gatewayEventId: event.event_id,
      gatewaySubscriptionId: event.subscription_id,
      newStatus: kind === "subscription_past_due" ? "past_due" : "cancelled",
      currentPeriodEnd: event.current_period_end ?? null,
    });
  }

  // Eventos com transação (purchase_paid, subscription_renewed, refunded, chargeback)
  const normalized: NormalizedPurchase = {
    gateway: "assiny",
    eventKind: kind,
    gatewayEventId: event.event_id,
    gatewayProductId: event.product.id,
    customer: {
      email: event.customer.email,
      name: event.customer.name,
      phone: event.customer.phone,
    },
    amount: event.amount,
    status: mapPurchaseStatus(kind),
    utm: event.utm,
    subscription: event.subscription_id
      ? {
          gatewaySubscriptionId: event.subscription_id,
          currentPeriodEnd: event.current_period_end ?? null,
        }
      : undefined,
  };
  return recordPurchase(hub, normalized);
}
