import type { SupabaseClient } from "@supabase/supabase-js";
import { extractGatewayEventId, type HublaEvent } from "../parsers/hubla.schema";
import {
  recordPurchase,
  recordLostPurchase,
  handleSubscriptionStatusEvent,
  type NormalizedPurchase,
  type LostKind,
  type PurchaseStatus,
  type EventKind,
} from "./shared";
import { logEvent } from "../logger";

/**
 * Classifica o `type` da Hubla numa categoria do hub.
 * Retorna "lost:<kind>" pra vendas perdidas e "unknown" pro que ignoramos.
 */
function classifyHublaEvent(
  type: string,
  paymentMethod?: string | null,
): EventKind | `lost:${LostKind}` | "unknown" {
  switch (type) {
    case "invoice.payment_succeeded":
      return "purchase_paid";
    case "invoice.refunded":
    case "refund_request.accepted":
      return "purchase_refunded";
    case "invoice.payment_failed":
      return "purchase_refused";
    case "invoice.expired": {
      const pm = (paymentMethod ?? "").toLowerCase();
      if (pm.includes("bank_slip") || pm.includes("boleto")) return "lost:billet_expired";
      return "lost:pix_expired";
    }
    case "lead.abandoned_checkout":
      return "lost:cart_abandoned";
    // Assinatura: desativada/expirada = cancelamento (grants rodam até o fim do ciclo)
    case "subscription.deactivated":
    case "subscription.expired":
      return "subscription_cancelled";
    default:
      return "unknown";
  }
}

function mapPurchaseStatus(kind: EventKind): PurchaseStatus {
  if (kind === "purchase_refunded") return "refunded";
  if (kind === "purchase_chargeback") return "chargeback";
  if (kind === "purchase_refused") return "refused";
  return "paid";
}

/** credit_card | pix | bank_slip → cartao | pix | boleto (vocabulário dos dashboards). */
function mapPaymentMethod(pm?: string | null): string | undefined {
  if (!pm) return undefined;
  const s = pm.toLowerCase();
  if (s.includes("credit") || s.includes("card")) return "cartao";
  if (s.includes("pix")) return "pix";
  if (s.includes("slip") || s.includes("boleto")) return "boleto";
  return pm;
}

function personName(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string | undefined {
  if (!p) return undefined;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return name || undefined;
}

export async function handleHublaEvent(hub: SupabaseClient, event: HublaEvent) {
  const inv = event.event.invoice;
  const kind = classifyHublaEvent(event.type, inv?.paymentMethod);
  const gatewayEventId = extractGatewayEventId(event);

  await logEvent(hub, "webhook.classified", {
    payload: {
      gateway: "hubla",
      type: event.type,
      classified_as: kind,
      gateway_event_id: gatewayEventId,
    },
  });

  if (kind === "unknown") {
    return { skipped: true as const, reason: "unknown_event_kind" };
  }

  // Vendas perdidas (pix/boleto expirado, carrinho abandonado)
  if (typeof kind === "string" && kind.startsWith("lost:")) {
    return handleHublaLostEvent(hub, event, kind.slice(5) as LostKind);
  }

  // Status-only de assinatura (cancelamento) — não cria purchase
  if (kind === "subscription_cancelled" || kind === "subscription_past_due") {
    const subId = event.event.subscription?.id ?? inv?.subscriptionId;
    if (!subId) return { skipped: true as const, reason: "missing_subscription_id" };
    return handleSubscriptionStatusEvent(hub, {
      gateway: "hubla",
      gatewayEventId,
      gatewaySubscriptionId: subId,
      newStatus: kind === "subscription_cancelled" ? "cancelled" : "past_due",
      currentPeriodEnd:
        event.event.subscription?.currentPeriodEnd ??
        event.event.subscription?.nextBillingDate ??
        null,
    });
  }

  // Daqui pra baixo: eventos de compra (paid / refunded / refused) precisam da invoice
  if (!inv) return { skipped: true as const, reason: "missing_data" };

  const mainProduct = event.event.product ?? event.event.products?.[0];
  const productGwId = mainProduct?.id;
  if (!productGwId) return { skipped: true as const, reason: "missing_product_id" };

  const offer = event.event.products?.[0]?.offers?.[0];
  const payer = inv.payer;
  const email = payer?.email ?? event.event.user?.email;

  // Sem e-mail não dá pra criar/achar o cliente (eventos de teste)
  if (!email) {
    await logEvent(hub, "webhook.test_event_no_client", {
      level: "info",
      payload: { gateway: "hubla", type: event.type },
    });
    return { skipped: true as const, reason: "test_event_no_client" };
  }

  const eventKind = kind as EventKind;
  const utm = inv.firstPaymentSession?.utm;

  // Hubla = BRUTO (igual Assiny): amount = totalCents/100, sem net_amount.
  // (o receivers[] separa taxa da plataforma da parte do produtor, mas por
  //  decisão do operador a receita conta o valor cheio pago pelo cliente.)
  const amount = (inv.amount?.totalCents ?? 0) / 100;

  const normalized: NormalizedPurchase = {
    gateway: "hubla",
    eventKind,
    gatewayEventId,
    txExternalId: inv.id,
    gatewayProductId: productGwId,
    productNameHint: mainProduct?.name ?? undefined,
    paymentMethod: mapPaymentMethod(inv.paymentMethod),
    occurredAt: inv.saleDate ?? inv.createdAt ?? undefined,
    gatewayOfferId: offer?.id ?? undefined,
    gatewayOfferName: offer?.name ?? undefined,
    subscriptionCycle: event.event.subscription?.cycle ?? undefined,
    customer: {
      email,
      name: personName(payer) ?? personName(event.event.user),
      phone: payer?.phone ?? event.event.user?.phone ?? undefined,
    },
    amount,
    status: mapPurchaseStatus(eventKind),
    utm: {
      source: utm?.source ?? undefined,
      medium: utm?.medium ?? undefined,
      campaign: utm?.campaign ?? undefined,
      content: utm?.content ?? undefined,
      term: utm?.term ?? undefined,
    },
    subscription: inv.subscriptionId
      ? {
          gatewaySubscriptionId: inv.subscriptionId,
          currentPeriodEnd:
            event.event.subscription?.currentPeriodEnd ??
            event.event.subscription?.nextBillingDate ??
            null,
        }
      : undefined,
  };

  return recordPurchase(hub, normalized);
}

/**
 * Vendas perdidas: registra pra aparecer em /recovery. Não cria customer/grant.
 */
async function handleHublaLostEvent(hub: SupabaseClient, event: HublaEvent, kind: LostKind) {
  const inv = event.event.invoice;
  const mainProduct = event.event.product ?? event.event.products?.[0];
  const offer = event.event.products?.[0]?.offers?.[0];
  const payer = inv?.payer;
  const utm = inv?.firstPaymentSession?.utm;
  const amountCents = inv?.amount?.totalCents ?? 0;

  return recordLostPurchase(hub, {
    platform: "hubla",
    kind,
    externalEventId: extractGatewayEventId(event),
    email: payer?.email ?? event.event.user?.email ?? undefined,
    phone: payer?.phone ?? event.event.user?.phone ?? undefined,
    productGatewayId: mainProduct?.id ?? undefined,
    productNameHint: mainProduct?.name ?? undefined,
    offerName: offer?.name ?? undefined,
    amountCents,
    utm: {
      source: utm?.source ?? undefined,
      medium: utm?.medium ?? undefined,
      campaign: utm?.campaign ?? undefined,
      content: utm?.content ?? undefined,
      term: utm?.term ?? undefined,
    },
    paymentMethod: mapPaymentMethod(inv?.paymentMethod),
    occurredAt: inv?.createdAt ?? inv?.saleDate ?? new Date().toISOString(),
    rawPayload: event,
  });
}
