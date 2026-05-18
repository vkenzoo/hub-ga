import type { SupabaseClient } from "@supabase/supabase-js";
import { GRACE_PERIOD_DAYS } from "@hub/shared";
import {
  provisionForPurchase,
  revokeGrantsForPurchase,
  extendGrantsOnRenewal,
  adjustGrantsOnSubscriptionStatus,
} from "../provisioning";
import { logEvent } from "../logger";

export type Gateway = "assiny" | "hotmart";
export type PurchaseStatus = "paid" | "refunded" | "chargeback" | "pending";

/**
 * Canonicaliza o tipo do evento entre gateways.
 *  - purchase_paid       → nova compra/cobrança (inclui 1ª compra E renovações)
 *  - purchase_refunded   → estorno
 *  - purchase_chargeback → chargeback
 *  - subscription_renewed → renovação (também pode chegar como purchase_paid; ver classificador)
 *  - subscription_past_due → pagamento de renovação falhou (grace period)
 *  - subscription_cancelled → assinatura cancelada (segue rodando até current_period_end)
 */
export type EventKind =
  | "purchase_paid"
  | "purchase_refunded"
  | "purchase_chargeback"
  | "subscription_renewed"
  | "subscription_past_due"
  | "subscription_cancelled";

export interface NormalizedPurchase {
  gateway: Gateway;
  eventKind: EventKind;
  gatewayEventId: string;
  gatewayProductId: string;
  productNameHint?: string;
  paymentMethod?: string;
  gatewayOfferId?: string;
  gatewayOfferName?: string;
  gatewayFunnelName?: string;
  customer: { email: string; name?: string; phone?: string };
  amount: number;
  status: PurchaseStatus;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  affiliateId?: string;
  subscription?: {
    gatewaySubscriptionId: string;
    currentPeriodEnd?: string | null;
  };
}

export interface SubscriptionStatusEvent {
  gateway: Gateway;
  gatewayEventId: string;
  gatewaySubscriptionId: string;
  newStatus: "past_due" | "cancelled";
  currentPeriodEnd?: string | null;
}

type FoundProduct = { id: string; pendingConfig: boolean };

async function findProductByGatewayId(
  hub: SupabaseClient,
  gateway: Gateway,
  gatewayProductId: string,
): Promise<FoundProduct | null> {
  const { data, error } = await hub
    .from("products")
    .select("id, pending_config")
    .filter("gateway_ids->>" + gateway, "eq", gatewayProductId)
    .maybeSingle();
  if (error) {
    console.error("[findProductByGatewayId]", error);
    return null;
  }
  return data
    ? { id: data.id as string, pendingConfig: Boolean(data.pending_config) }
    : null;
}

/**
 * Auto-cadastra produto descoberto via webhook como rascunho. Admin precisa
 * abrir no dashboard e configurar entitlements + duration antes de provisionar.
 */
async function createDraftProduct(
  hub: SupabaseClient,
  gateway: Gateway,
  gatewayProductId: string,
  nameHint: string | undefined,
): Promise<void> {
  const name = nameHint?.trim() || `[draft] ${gateway} ${gatewayProductId}`;
  const { error } = await hub.from("products").insert({
    name,
    billing_type: "one_time",
    gateway_ids: { [gateway]: gatewayProductId },
    requires_app_access: true,
    pending_config: true,
  });
  if (error) {
    console.error("[createDraftProduct]", error);
  }
}

async function upsertCustomer(
  hub: SupabaseClient,
  email: string,
  source: Gateway,
  name?: string,
  phone?: string,
): Promise<string | null> {
  const { data: existing } = await hub
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await hub
    .from("customers")
    .insert({ email, name: name ?? null, phone: phone ?? null, source })
    .select("id")
    .single();
  if (error) {
    console.error("[upsertCustomer]", error);
    return null;
  }
  return data.id as string;
}

/**
 * Processa evento com transação (compra ou renovação).
 * Idempotente via (gateway, gateway_event_id).
 */
export async function recordPurchase(
  hub: SupabaseClient,
  p: NormalizedPurchase,
): Promise<
  | { skipped: true; reason: string }
  | { skipped: false; customerId: string; purchaseId: string }
> {
  // 1. Dedupe
  const { data: existing } = await hub
    .from("purchases")
    .select("id, customer_id")
    .eq("gateway", p.gateway)
    .eq("gateway_event_id", p.gatewayEventId)
    .maybeSingle();

  if (existing) {
    await logEvent(hub, "webhook.dedupe.skip", {
      payload: { gateway: p.gateway, gateway_event_id: p.gatewayEventId, kind: p.eventKind },
      customerId: existing.customer_id as string,
      purchaseId: existing.id as string,
    });
    return { skipped: true, reason: "duplicate" };
  }

  // 2. Resolve produto. Se não existir, auto-cadastra como rascunho e pula.
  // Se existir mas estiver pending_config, também pula (admin ainda não configurou).
  const product = await findProductByGatewayId(hub, p.gateway, p.gatewayProductId);
  if (!product) {
    await createDraftProduct(hub, p.gateway, p.gatewayProductId, p.productNameHint);
    await logEvent(hub, "webhook.product_drafted", {
      level: "warn",
      payload: {
        gateway: p.gateway,
        gateway_product_id: p.gatewayProductId,
        name_hint: p.productNameHint ?? null,
        email: p.customer.email,
      },
    });
    return { skipped: true, reason: "unknown_product" };
  }
  if (product.pendingConfig) {
    await logEvent(hub, "webhook.product_pending_config", {
      level: "warn",
      payload: {
        gateway: p.gateway,
        gateway_product_id: p.gatewayProductId,
        product_id: product.id,
        email: p.customer.email,
      },
    });
    return { skipped: true, reason: "unknown_product" };
  }

  // 3. Upsert customer
  const customerId = await upsertCustomer(
    hub,
    p.customer.email,
    p.gateway,
    p.customer.name,
    p.customer.phone,
  );
  if (!customerId) return { skipped: true, reason: "customer_insert_failed" };

  // 4. Insere purchase
  const { data: purchase, error: purchaseErr } = await hub
    .from("purchases")
    .insert({
      customer_id: customerId,
      product_id: product.id,
      gateway: p.gateway,
      gateway_event_id: p.gatewayEventId,
      amount: p.amount,
      status: p.status,
      utm_source: p.utm?.source ?? null,
      utm_medium: p.utm?.medium ?? null,
      utm_campaign: p.utm?.campaign ?? null,
      utm_content: p.utm?.content ?? null,
      utm_term: p.utm?.term ?? null,
      affiliate_id: p.affiliateId ?? null,
      payment_method: p.paymentMethod ?? null,
      gateway_offer_id: p.gatewayOfferId ?? null,
      gateway_offer_name: p.gatewayOfferName ?? null,
      gateway_funnel_name: p.gatewayFunnelName ?? null,
    })
    .select("id")
    .single();

  if (purchaseErr || !purchase) {
    console.error("[recordPurchase] insert failed:", purchaseErr);
    return { skipped: true, reason: "purchase_insert_failed" };
  }
  const purchaseId = purchase.id as string;

  // 5. Subscription upsert (se aplicável)
  let subscriptionId: string | null = null;
  if (p.subscription) {
    const { data: sub } = await hub
      .from("subscriptions")
      .upsert(
        {
          customer_id: customerId,
          product_id: product.id,
          gateway: p.gateway,
          gateway_subscription_id: p.subscription.gatewaySubscriptionId,
          status: "active",
          current_period_end: p.subscription.currentPeriodEnd ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "gateway,gateway_subscription_id" },
      )
      .select("id")
      .single();
    if (sub?.id) subscriptionId = sub.id as string;
  }

  await logEvent(hub, "webhook.processed", {
    payload: { gateway: p.gateway, gateway_event_id: p.gatewayEventId, kind: p.eventKind, status: p.status },
    customerId,
    purchaseId,
  });

  // 6. Side effects por tipo de evento
  switch (p.eventKind) {
    case "purchase_paid":
      try {
        await provisionForPurchase(hub, customerId, product.id, purchaseId, {
          gateway: p.gateway,
          gatewaySubscriptionId: p.subscription?.gatewaySubscriptionId,
        });
      } catch (err) {
        console.error("[recordPurchase] provisionForPurchase failed:", err);
      }
      break;

    case "subscription_renewed":
      // Estende grants existentes da assinatura em vez de criar grants novos.
      if (subscriptionId && p.subscription?.currentPeriodEnd) {
        try {
          await extendGrantsOnRenewal(hub, subscriptionId, p.subscription.currentPeriodEnd);
        } catch (err) {
          console.error("[recordPurchase] extendGrantsOnRenewal failed:", err);
        }
      }
      break;

    case "purchase_refunded":
    case "purchase_chargeback":
      try {
        await revokeGrantsForPurchase(hub, purchaseId);
      } catch (err) {
        console.error("[recordPurchase] revoke failed:", err);
      }
      break;
  }

  return { skipped: false, customerId, purchaseId };
}

/**
 * Eventos puramente de mudança de status (past_due / cancelled).
 * Não cria purchase — só atualiza subscription + ajusta grants.
 */
export async function handleSubscriptionStatusEvent(
  hub: SupabaseClient,
  e: SubscriptionStatusEvent,
): Promise<{ ok: boolean; reason?: string }> {
  // Localiza subscription
  const { data: sub } = await hub
    .from("subscriptions")
    .select("id, current_period_end")
    .eq("gateway", e.gateway)
    .eq("gateway_subscription_id", e.gatewaySubscriptionId)
    .maybeSingle();

  if (!sub) {
    await logEvent(hub, "webhook.subscription.unknown", {
      level: "warn",
      payload: { gateway: e.gateway, gatewaySubscriptionId: e.gatewaySubscriptionId },
    });
    return { ok: false, reason: "unknown_subscription" };
  }

  // Update status
  await hub
    .from("subscriptions")
    .update({
      status: e.newStatus,
      current_period_end: e.currentPeriodEnd ?? sub.current_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id as string);

  // Adjust grants
  try {
    await adjustGrantsOnSubscriptionStatus(
      hub,
      sub.id as string,
      e.newStatus,
      e.currentPeriodEnd ?? (sub.current_period_end as string | null),
    );
  } catch (err) {
    console.error("[handleSubscriptionStatusEvent] adjust failed:", err);
  }

  await logEvent(hub, "webhook.subscription.status_change", {
    payload: { gateway: e.gateway, gatewaySubscriptionId: e.gatewaySubscriptionId, newStatus: e.newStatus },
  });

  return { ok: true };
}

export { revokeGrantsForPurchase };
export const GRACE_DAYS = GRACE_PERIOD_DAYS;
