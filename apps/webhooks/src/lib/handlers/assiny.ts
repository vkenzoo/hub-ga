import type { SupabaseClient } from "@supabase/supabase-js";
import { extractGatewayEventId, type AssinyEvent } from "../parsers/assiny.schema";
import {
  recordPurchase,
  handleSubscriptionStatusEvent,
  type NormalizedPurchase,
  type PurchaseStatus,
  type EventKind,
} from "./shared";
import { logEvent } from "../logger";

/**
 * Mapeia o `event` do Assiny pro EventKind canônico do hub.
 * Eventos documentados: https://assiny.gitbook.io/assiny-docs/webhooks
 */
function classifyAssinyEvent(eventName: string, status?: string): EventKind | "unknown" {
  const t = `${eventName} ${status ?? ""}`.toLowerCase();

  if (t.includes("refund")) return "purchase_refunded";
  if (t.includes("chargeback")) return "purchase_chargeback";

  // Subscription-only (sem nova cobrança)
  if (t.includes("subscription_cancel") || t.includes("assinatura_cancel") || t.includes("subscription_canceled")) {
    return "subscription_cancelled";
  }
  if (
    t.includes("past_due") ||
    t.includes("overdue") ||
    t.includes("delayed") ||
    t.includes("pix_expir")
  ) {
    return "subscription_past_due";
  }

  // Renovação recorrente — Assiny pode mandar approved_purchase com cycle > 1
  // Tratamos abaixo via heurística de cycle, então aqui só pega nomes explícitos
  if (t.includes("renew") || t.includes("recurr") || t.includes("recurring")) {
    return "subscription_renewed";
  }

  // Compra aprovada/concluída
  if (
    t.includes("approved_purchase") ||
    t.includes("completed_purchase") ||
    t.includes("paid") ||
    t.includes("approved")
  ) {
    return "purchase_paid";
  }

  return "unknown";
}

function mapPurchaseStatus(kind: EventKind): PurchaseStatus {
  if (kind === "purchase_refunded") return "refunded";
  if (kind === "purchase_chargeback") return "chargeback";
  return "paid";
}

function customerName(c: NonNullable<AssinyEvent["data"]["customer"]>): string | undefined {
  if (c.full_name) return c.full_name;
  if (c.first_name && c.last_name) return `${c.first_name} ${c.last_name}`;
  return c.first_name ?? c.last_name;
}

function extractAmount(e: AssinyEvent): number {
  const d = e.data;
  const raw = d.amount ?? d.offer?.amount ?? 0;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? Number(n) : 0;
}

export async function handleAssinyEvent(hub: SupabaseClient, event: AssinyEvent) {
  const d = event.data;
  let kind = classifyAssinyEvent(event.event, d.status);

  // Heurística: approved_purchase com subscription.cycle > 1 = renovação, não 1ª compra
  if (kind === "purchase_paid" && d.subscription?.cycle && d.subscription.cycle > 1) {
    kind = "subscription_renewed";
  }

  // Log do tradutor pra debug
  await logEvent(hub, "webhook.received", {
    level: kind === "unknown" ? "warn" : "info",
    payload: {
      gateway: "assiny",
      raw_event_type: event.event,
      raw_status: d.status ?? null,
      classified_as: kind,
      subscription_cycle: d.subscription?.cycle ?? null,
      gateway_event_id: extractGatewayEventId(event),
    },
  });

  if (kind === "unknown") {
    return { skipped: true as const, reason: "unknown_event_kind" };
  }

  const gatewayEventId = extractGatewayEventId(event);

  // Status-only events
  if (kind === "subscription_past_due" || kind === "subscription_cancelled") {
    const subId = d.subscription?.id;
    if (!subId) return { skipped: true as const, reason: "missing_subscription_id" };
    return handleSubscriptionStatusEvent(hub, {
      gateway: "assiny",
      gatewayEventId,
      gatewaySubscriptionId: subId,
      newStatus: kind === "subscription_past_due" ? "past_due" : "cancelled",
      currentPeriodEnd: d.subscription?.next_billing_date ?? d.subscription?.current_period_end ?? null,
    });
  }

  // Test events do Assiny podem vir sem customer real
  if (!d.customer?.email) {
    await logEvent(hub, "webhook.test_event_no_customer", {
      level: "info",
      payload: { gateway: "assiny", event: event.event },
    });
    return { skipped: true as const, reason: "test_event_no_customer" };
  }

  // Resolve product gateway_id — Assiny tem dois IDs (product + offer).
  // Tentamos product.id primeiro (catálogo), depois offer.id (variante de preço).
  const productGwId = d.product?.id ?? d.offer?.id;
  if (!productGwId) {
    return { skipped: true as const, reason: "missing_product_id" };
  }

  // UTMs vivem em metadata.url_parameters
  const utm = d.metadata?.url_parameters ?? {};

  // Affiliate code — Assiny tem "transaction.commissions" como array; pega o 1º
  const affiliate = d.transaction?.commissions?.[0];
  const affiliateId = affiliate?.user?.id ? String(affiliate.user.id) : undefined;

  const normalized: NormalizedPurchase = {
    gateway: "assiny",
    eventKind: kind,
    gatewayEventId,
    gatewayProductId: productGwId,
    customer: {
      email: d.customer.email!,
      name: customerName(d.customer),
      phone: d.customer.phone,
    },
    amount: extractAmount(event),
    status: mapPurchaseStatus(kind),
    utm: {
      source: utm.utm_source,
      medium: utm.utm_medium,
      campaign: utm.utm_campaign,
      content: utm.utm_content,
      term: utm.utm_term,
    },
    affiliateId,
    subscription: d.subscription?.id
      ? {
          gatewaySubscriptionId: d.subscription.id,
          currentPeriodEnd: d.subscription.next_billing_date ?? d.subscription.current_period_end ?? null,
        }
      : undefined,
  };
  return recordPurchase(hub, normalized);
}
