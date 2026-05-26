import type { SupabaseClient } from "@supabase/supabase-js";
import { extractGatewayEventId, type AssinyEvent } from "../parsers/assiny.schema";
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
 * Classifica evento Assiny em uma das categorias do hub.
 * Retorna "lost:<kind>" pra eventos de venda perdida (PIX expirado, carrinho abandonado).
 *
 * IMPORTANTE: pix_expired pode ser tanto de venda nova quanto de renovação de assinatura.
 * A distinção é feita no handler com base em is_subscription_renew/cycle.
 */
function classifyAssinyEvent(
  eventName: string,
  status?: string,
): EventKind | `lost:${LostKind}` | "unknown" {
  const t = `${eventName} ${status ?? ""}`.toLowerCase();

  if (t.includes("refund")) return "purchase_refunded";
  if (t.includes("chargeback")) return "purchase_chargeback";

  if (t.includes("subscription_cancel") || t.includes("assinatura_cancel")) {
    return "subscription_cancelled";
  }

  // PIX/boleto expirado — pode ser venda nova OU renovação. Decide depois.
  if (t.includes("pix_expir")) return "lost:pix_expired";
  if (t.includes("billet_expir") || t.includes("boleto_expir")) return "lost:billet_expired";

  if (t.includes("abandoned_checkout") || t.includes("cart_abandon")) {
    return "lost:cart_abandoned";
  }
  if (t.includes("pix_generated") || t.includes("pix_pending")) return "lost:pix_pending";
  if (t.includes("billet_generated") || t.includes("billet_printed")) return "lost:billet_pending";

  if (t.includes("past_due") || t.includes("overdue") || t.includes("delayed")) {
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
  // Refino: pix_expired/billet_expired DE RENOVAÇÃO → trata como subscription_past_due
  // (não é "venda perdida", é só assinatura em atraso esperando renovar)
  if ((kind === "lost:pix_expired" || kind === "lost:billet_expired") && isRenewal) {
    kind = "subscription_past_due";
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

  // Rota especial: vendas perdidas (PIX expirado, carrinho abandonado, PIX gerado pendente)
  if (typeof kind === "string" && kind.startsWith("lost:")) {
    return handleAssinyLostEvent(hub, event, kind.slice(5) as LostKind);
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

  // A essa altura kind só pode ser EventKind (não 'unknown' e não 'lost:*')
  const eventKind = kind as EventKind;

  const normalized: NormalizedPurchase = {
    gateway: "assiny",
    eventKind,
    gatewayEventId,
    txExternalId: tx?.id ?? undefined,
    gatewayProductId: productGwId,
    productNameHint: event.data.offer?.product?.name ?? event.data.offer?.name,
    paymentMethod: tx?.payment_type ?? undefined,
    gatewayOfferId: event.data.offer?.id ?? undefined,
    gatewayOfferName: event.data.offer?.name ?? undefined,
    gatewayFunnelName: funnelRef?.trim() || undefined,
    subscriptionCycle: event.data.subscription?.cycle ?? undefined,
    customer: {
      email: client.email,
      name: clientName(client),
      phone: client.phone,
    },
    amount: extractAmount(event),
    status: mapPurchaseStatus(eventKind),
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

/**
 * Trata eventos de venda perdida da Assiny:
 *   - abandoned_checkout (não tem transaction)
 *   - pix_generated     (transaction com status pix_generated)
 *   - pix_expired       (apenas vendas novas — renovação foi rerouteada antes)
 *
 * Não cria customer, não provisiona — só registra em lost_purchases.
 */
async function handleAssinyLostEvent(
  hub: SupabaseClient,
  event: AssinyEvent,
  lostKind: LostKind,
) {
  const tx = txOf(event);
  const meta = metaOf(event);
  const client = clientOf(event);

  // Test events sem client real
  if (!client?.email && !client?.phone) {
    await logEvent(hub, "webhook.lost.no_client", {
      level: "info",
      payload: { gateway: "assiny", event: event.event, kind: lostKind },
    });
    return { skipped: true as const, reason: "no_client" };
  }

  // External ID: tx.id quando existe (pix_*), senão composto (cart_abandoned)
  // Assiny pode mandar abandoned_checkout sem transaction — usamos offer+email+created_at.
  let externalEventId: string;
  if (tx?.id) {
    externalEventId = tx.id;
  } else {
    const createdAt = (event.data as { created_at?: string }).created_at ?? new Date().toISOString();
    const offerId = event.data.offer?.id ?? "?";
    externalEventId = `${offerId}_${client.email ?? client.phone ?? "?"}_${createdAt}`;
  }

  // UTMs (mesmo pattern do handler principal)
  const m = meta ?? {};
  const urlParams = (m.url_parameters ?? {}) as Record<string, string>;
  const utm = {
    source: m.utm_source ?? urlParams.utm_source,
    medium: m.utm_medium ?? urlParams.utm_medium,
    campaign: m.utm_campaign ?? urlParams.utm_campaign,
    content: m.utm_content ?? urlParams.utm_content,
    term: m.utm_term ?? urlParams.utm_term,
  };

  // Valor: pra abandoned_checkout não tem transaction, pega de offer.amount.
  const amount = (() => {
    const raw =
      tx?.amount ??
      event.data.transaction?.amount ??
      event.data.offer?.amount ??
      0;
    const n = typeof raw === "string" ? Number(raw) : raw;
    return Number.isFinite(n) ? Number(n) : 0;
  })();

  const productGwId = event.data.offer?.product?.id ?? event.data.offer?.id;

  // PIX QR code (só pra pix_expired registramos pra contexto)
  const additionalData = (event.data.transaction as Record<string, unknown> | undefined)
    ?.additional_data as Record<string, unknown> | undefined;
  const pixData = additionalData?.PIX as Record<string, unknown> | undefined;
  const qrCode = typeof pixData?.qr_code === "string" ? pixData.qr_code : undefined;

  const occurredAt = (() => {
    const txUpdated = (tx as { updated_at?: string } | undefined)?.updated_at;
    const txCreated = (tx as { created_at?: string } | undefined)?.created_at;
    const dataCreated = (event.data as { created_at?: string }).created_at;
    return txUpdated ?? txCreated ?? dataCreated ?? new Date().toISOString();
  })();

  const lp: NormalizedLostPurchase = {
    platform: "assiny",
    kind: lostKind,
    externalEventId,
    email: client.email,
    phone: client.phone,
    productGatewayId: productGwId,
    productNameHint: event.data.offer?.product?.name ?? event.data.offer?.name,
    offerName: event.data.offer?.name,
    amountCents: amount,
    utm,
    funnelRef: m.short_funnel_id ?? m.funnel_id,
    eventSourceUrl: m.event_source_url,
    paymentMethod: tx?.payment_type,
    expiredQrCode: lostKind === "pix_expired" ? qrCode : undefined,
    occurredAt,
    rawPayload: event,
  };

  return recordLostPurchase(hub, lp);
}
