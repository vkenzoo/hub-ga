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

function classifyAssinyEvent(eventName: string, status?: string): EventKind | "unknown" {
  const t = `${eventName} ${status ?? ""}`.toLowerCase();

  if (t.includes("refund")) return "purchase_refunded";
  if (t.includes("chargeback")) return "purchase_chargeback";

  if (t.includes("subscription_cancel") || t.includes("assinatura_cancel")) {
    return "subscription_cancelled";
  }
  if (t.includes("past_due") || t.includes("overdue") || t.includes("delayed") || t.includes("pix_expir")) {
    return "subscription_past_due";
  }
  if (t.includes("renew") || t.includes("recurr")) {
    return "subscription_renewed";
  }

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

function clientName(c: NonNullable<AssinyEvent["client"]>): string | undefined {
  if (c.full_name) return c.full_name;
  if (c.first_name && c.last_name) return `${c.first_name} ${c.last_name}`;
  return c.first_name ?? c.last_name;
}

function extractAmount(e: AssinyEvent): number {
  const raw =
    e.data.transaction?.amount ??
    e.transaction?.amount ??
    e.data.offer?.amount ??
    0;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? Number(n) : 0;
}

// Conforme doc da Assiny, transaction/metadata/client ficam dentro de data.
// Eventos de teste antigos vinham top-level. Lemos dos dois com fallback.
function txOf(event: AssinyEvent) {
  return event.data.transaction ?? event.transaction;
}
function metaOf(event: AssinyEvent) {
  return event.data.metadata ?? event.metadata;
}
function clientOf(event: AssinyEvent) {
  return event.data.client ?? event.client;
}

export async function handleAssinyEvent(hub: SupabaseClient, event: AssinyEvent) {
  const tx = txOf(event);
  const meta = metaOf(event);
  const client = clientOf(event);
  let kind = classifyAssinyEvent(event.event, tx?.status);

  // Heurística: approved_purchase com subscription.cycle > 1 OU is_subscription_renew=true → renovação
  const isRenewal =
    event.data.subscription?.is_subscription_renew === true ||
    (event.data.subscription?.cycle ?? 0) > 1;
  if (kind === "purchase_paid" && isRenewal) {
    kind = "subscription_renewed";
  }

  const gatewayEventId = extractGatewayEventId(event);

  // Log do tradutor
  await logEvent(hub, "webhook.received", {
    level: kind === "unknown" ? "warn" : "info",
    payload: {
      gateway: "assiny",
      raw_event_type: event.event,
      raw_status: tx?.status ?? null,
      classified_as: kind,
      subscription_cycle: event.data.subscription?.cycle ?? null,
      is_renew: isRenewal,
      gateway_event_id: gatewayEventId,
    },
  });

  if (kind === "unknown") {
    return { skipped: true as const, reason: "unknown_event_kind" };
  }

  // Test events do Assiny podem vir sem client real (sem email)
  if (!client || !client.email) {
    await logEvent(hub, "webhook.test_event_no_client", {
      level: "info",
      payload: { gateway: "assiny", event: event.event },
    });
    return { skipped: true as const, reason: "test_event_no_client" };
  }

  // Status-only events (sub_past_due / sub_cancelled)
  if (kind === "subscription_past_due" || kind === "subscription_cancelled") {
    const subId = event.data.subscription?.id;
    if (!subId) return { skipped: true as const, reason: "missing_subscription_id" };
    return handleSubscriptionStatusEvent(hub, {
      gateway: "assiny",
      gatewayEventId,
      gatewaySubscriptionId: subId,
      newStatus: kind === "subscription_past_due" ? "past_due" : "cancelled",
      currentPeriodEnd:
        event.data.subscription?.next_billing_date ??
        event.data.subscription?.current_period_end ??
        null,
    });
  }

  // Resolve product gateway_id. Assiny tem offer.id e offer.product.id (catálogo).
  // Preferimos offer.product.id (mais estável) → fallback pra offer.id (variante).
  const productGwId = event.data.offer?.product?.id ?? event.data.offer?.id;
  if (!productGwId) {
    return { skipped: true as const, reason: "missing_product_id" };
  }

  const m = meta ?? {};
  // UTMs podem vir top-level no metadata ou em url_parameters
  const urlParams = (m.url_parameters ?? {}) as Record<string, string>;
  const utm = {
    source: m.utm_source ?? urlParams.utm_source,
    medium: m.utm_medium ?? urlParams.utm_medium,
    campaign: m.utm_campaign ?? urlParams.utm_campaign,
    content: m.utm_content ?? urlParams.utm_content,
    term: m.utm_term ?? urlParams.utm_term,
  };

  // Affiliate — 1ª commission user_id
  const aff = tx?.commissions?.[0];
  let affiliateId: string | undefined;
  if (aff?.user) {
    if (typeof aff.user === "string" || typeof aff.user === "number") {
      affiliateId = String(aff.user);
    } else if (typeof aff.user === "object" && "id" in aff.user) {
      affiliateId = String((aff.user as { id: unknown }).id);
    }
  }
  if (!affiliateId && aff?.email) affiliateId = aff.email;

  // Funil: a Assiny envia metadata.short_funnel_id (ex: "hncFVu") e metadata.funnel_id (uuid).
  // O short_funnel_id é o que aparece na URL do admin (/node/hncFVu), mais reconhecível.
  // O nome amigável ("[SGVA] - F01") só existe no admin — pode ser mapeado depois via tabela.
  const funnelRef = m.short_funnel_id ?? m.funnel_id;

  const normalized: NormalizedPurchase = {
    gateway: "assiny",
    eventKind: kind,
    gatewayEventId,
    gatewayProductId: productGwId,
    productNameHint: event.data.offer?.product?.name ?? event.data.offer?.name,
    paymentMethod: tx?.payment_type ?? undefined,
    gatewayOfferId: event.data.offer?.id ?? undefined,
    gatewayOfferName: event.data.offer?.name ?? undefined,
    gatewayFunnelName: funnelRef?.trim() || undefined,
    customer: {
      email: client.email,
      name: clientName(client),
      phone: client.phone,
    },
    amount: extractAmount(event),
    status: mapPurchaseStatus(kind),
    utm,
    affiliateId,
    subscription: event.data.subscription?.id
      ? {
          gatewaySubscriptionId: event.data.subscription.id,
          currentPeriodEnd:
            event.data.subscription.next_billing_date ??
            event.data.subscription.current_period_end ??
            null,
        }
      : undefined,
  };
  return recordPurchase(hub, normalized);
}
