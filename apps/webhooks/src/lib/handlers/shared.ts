import type { SupabaseClient } from "@supabase/supabase-js";
import { GRACE_PERIOD_DAYS } from "@hub/shared";
import {
  provisionForPurchase,
  revokeGrantsForPurchase,
  extendGrantsOnRenewal,
  adjustGrantsOnSubscriptionStatus,
} from "../provisioning";
import { logEvent } from "../logger";
import { resolveSaleAttribution, persistAttribution } from "./resolve-attribution";
import { enqueueOutboundDispatches, type OutboundEvent } from "../outbound/dispatch";

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
  /**
   * Transaction ID "puro" (sem sufixo de evento). Usado pra resolver
   * lost_purchases do mesmo tx quando o pagamento chega depois de
   * pix_generated/pix_expired. Opcional — se ausente, não tenta resolver.
   */
  txExternalId?: string;
  gatewayProductId: string;
  productNameHint?: string;
  paymentMethod?: string;
  gatewayOfferId?: string;
  gatewayOfferName?: string;
  gatewayFunnelName?: string;
  subscriptionCycle?: number;
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
  /**
   * Timestamp original da transação (do payload do gateway). Quando ausente,
   * usa NOW() (padrão). Importante pra replays — evita marcar venda antiga
   * com horário do replay.
   */
  occurredAt?: string; // ISO timestamp
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

export type LostKind =
  | "pix_pending"
  | "pix_expired"
  | "billet_pending"
  | "billet_expired"
  | "cart_abandoned";

export interface NormalizedLostPurchase {
  platform: Gateway;
  kind: LostKind;
  externalEventId: string;     // tx.id quando existir, senão composto
  email?: string;
  phone?: string;
  productGatewayId?: string;
  productNameHint?: string;
  offerName?: string;
  amountCents: number;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  funnelRef?: string;
  eventSourceUrl?: string;
  paymentMethod?: string;
  pixQrCode?: string;
  occurredAt: string;          // ISO
  rawPayload?: unknown;
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

/**
 * Normaliza telefone pra os últimos 11 dígitos (formato BR: DDD+9+8dig).
 * Aceita "+55 (11) 91234-5678", "11912345678", "5511912345678" → "11912345678".
 * Retorna null se phone não tem dígitos suficientes pra ser válido.
 */
export function normalizePhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-11);
}

/**
 * Localiza customer existente. Se não acha por email, tenta por telefone normalizado.
 * Isso permite agregar compras de produtos diferentes ao MESMO cliente quando ele
 * usa email diferente mas o mesmo número, ou vice-versa.
 *
 * Quando achado:
 *  - enriquece o registro com name/phone que estavam faltando
 *  - retorna o id existente (não cria duplicata)
 */
async function upsertCustomer(
  hub: SupabaseClient,
  email: string,
  source: Gateway,
  name?: string,
  phone?: string,
): Promise<string | null> {
  const phoneNorm = normalizePhone(phone);

  // 1. Match por email (caminho mais comum e mais barato — coluna única)
  let { data: existing } = await hub
    .from("customers")
    .select("id, email, name, phone")
    .eq("email", email)
    .maybeSingle();

  // 2. Fallback: match por telefone normalizado
  let matchedBy: "email" | "phone" | null = existing ? "email" : null;
  if (!existing && phoneNorm) {
    const { data: byPhone } = await hub
      .from("customers")
      .select("id, email, name, phone")
      .eq("phone_normalized", phoneNorm)
      .order("first_seen_at", { ascending: true })
      .limit(1);
    if (byPhone && byPhone.length > 0) {
      existing = byPhone[0]!;
      matchedBy = "phone";
      await logEvent(hub, "customer.merged_by_phone", {
        level: "info",
        payload: {
          existing_email: existing.email,
          incoming_email: email,
          phone_normalized: phoneNorm,
          customer_id: existing.id,
        },
        customerId: existing.id as string,
      });
    }
  }

  // 3. Achou? Enriquece dados faltantes e devolve o id
  if (existing) {
    const updates: Record<string, unknown> = {};
    if (!existing.name && name) updates.name = name;
    if (!existing.phone && phone) updates.phone = phone;
    if (Object.keys(updates).length > 0) {
      await hub.from("customers").update(updates).eq("id", existing.id as string);
    }
    if (matchedBy === "phone") {
      // Match por phone com email novo — mantemos o email original mas ficamos
      // sabendo que esse cliente também usa esse outro email.
      // (futuramente: tabela customer_emails pra histórico)
    }
    return existing.id as string;
  }

  // 4. Não achou nem por email nem por phone — cria novo
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

  // 4. Insere purchase. created_at = occurredAt do payload (se vier) ou NOW().
  // Importante pra replays — sem isso, vendas antigas reprocessadas ficariam
  // todas com timestamp do replay (não do horário real da transação).
  const purchaseRow: Record<string, unknown> = {
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
    subscription_cycle: p.subscriptionCycle ?? null,
  };
  if (p.occurredAt) {
    purchaseRow.created_at = p.occurredAt;
  }
  const { data: purchase, error: purchaseErr } = await hub
    .from("purchases")
    .insert(purchaseRow)
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

  // Fecha o lifecycle: se essa purchase corresponde a um pix_pending/pix_expired
  // (mesmo tx_id "puro"), marca como resolved.
  if ((p.eventKind === "purchase_paid" || p.eventKind === "subscription_renewed") && p.txExternalId) {
    try {
      await markLostResolvedByTxId(hub, p.gateway, p.txExternalId);
    } catch (err) {
      console.error("[recordPurchase] markLostResolved failed:", err);
    }
  }

  // Atribuição UTM → ad/campaign Meta (fire-and-forget — não bloqueia o handler).
  // Só roda em purchase_paid (vendas novas + renovações com cobrança nova).
  if (p.eventKind === "purchase_paid" || p.eventKind === "subscription_renewed") {
    resolveSaleAttribution(hub, {
      utm_source: p.utm?.source ?? null,
      utm_medium: p.utm?.medium ?? null,
      utm_campaign: p.utm?.campaign ?? null,
      utm_content: p.utm?.content ?? null,
      utm_term: p.utm?.term ?? null,
    })
      .then((result) => persistAttribution(hub, purchaseId, result))
      .catch((err) => console.error("[recordPurchase] attribution failed:", err));
  }

  // Outbound webhooks — enqueue dispatches em pending_jobs.
  // Cron processa em <5min com retry exponencial.
  const outboundEvent: OutboundEvent | null = (() => {
    switch (p.eventKind) {
      case "purchase_paid": return "purchase.paid";
      case "purchase_refunded": return "purchase.refunded";
      case "purchase_chargeback": return "purchase.chargeback";
      case "subscription_renewed": return "subscription.renewed";
      default: return null;
    }
  })();

  if (outboundEvent) {
    enqueueOutboundDispatches(hub, outboundEvent, {
      purchase: {
        id: purchaseId,
        amount: p.amount,
        status: p.status,
        gateway: p.gateway,
        gateway_event_id: p.gatewayEventId,
        payment_method: p.paymentMethod ?? null,
        utm_source: p.utm?.source ?? null,
        utm_medium: p.utm?.medium ?? null,
        utm_campaign: p.utm?.campaign ?? null,
        utm_content: p.utm?.content ?? null,
        utm_term: p.utm?.term ?? null,
        affiliate_id: p.affiliateId ?? null,
        subscription_cycle: p.subscriptionCycle ?? null,
      },
      customer: {
        id: customerId,
        email: p.customer.email,
        name: p.customer.name ?? null,
        phone: p.customer.phone ?? null,
      },
      product: {
        id: product.id,
        name_hint: p.productNameHint ?? null,
      },
    }).catch((err) => console.error("[recordPurchase] enqueueOutbound failed:", err));
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

  // Outbound dispatch
  const outboundEvent: OutboundEvent | null =
    e.newStatus === "past_due" ? "subscription.past_due"
    : e.newStatus === "cancelled" ? "subscription.cancelled"
    : null;

  if (outboundEvent) {
    enqueueOutboundDispatches(hub, outboundEvent, {
      subscription: {
        id: sub.id,
        gateway: e.gateway,
        gateway_subscription_id: e.gatewaySubscriptionId,
        status: e.newStatus,
        current_period_end: e.currentPeriodEnd ?? sub.current_period_end ?? null,
      },
    }).catch((err) => console.error("[subStatusEvent] enqueueOutbound failed:", err));
  }

  return { ok: true };
}

/**
 * Insere uma "venda perdida" (PIX/boleto não pago, carrinho abandonado).
 *
 * Idempotente via (platform, kind, external_event_id).
 *
 * Lifecycle do mesmo tx_id (Assiny):
 *   pix_generated → row pix_pending inserida
 *   ↓
 *   pix_expired → row pix_pending marcada resolved=true (resolvido por expiração)
 *                + nova row pix_expired inserida
 *   ↓
 *   approved_purchase → recordPurchase chama markLostResolved abaixo:
 *                       marca todas as rows daquele tx_id como resolved=true
 *
 * Não cria customer — só linka se já existir.
 */
export async function recordLostPurchase(
  hub: SupabaseClient,
  lp: NormalizedLostPurchase,
): Promise<{ skipped: true; reason: string } | { skipped: false; id: string }> {
  // 1. Dedupe
  const { data: existing } = await hub
    .from("lost_purchases")
    .select("id")
    .eq("platform", lp.platform)
    .eq("kind", lp.kind)
    .eq("external_event_id", lp.externalEventId)
    .maybeSingle();

  if (existing) {
    return { skipped: true, reason: "duplicate" };
  }

  // 2. Quando chega pix_expired, marca o pix_pending do mesmo tx como "resolved por expiração"
  if (lp.kind === "pix_expired" || lp.kind === "billet_expired") {
    const pendingKind = lp.kind === "pix_expired" ? "pix_pending" : "billet_pending";
    await hub
      .from("lost_purchases")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("platform", lp.platform)
      .eq("kind", pendingKind)
      .eq("external_event_id", lp.externalEventId);
  }

  // 3. Resolve customer_id (só se existir — não cria)
  const phoneNorm = normalizePhone(lp.phone);
  let customerId: string | null = null;
  if (lp.email) {
    const { data } = await hub
      .from("customers")
      .select("id")
      .eq("email", lp.email)
      .maybeSingle();
    if (data) customerId = data.id as string;
  }
  if (!customerId && phoneNorm) {
    const { data } = await hub
      .from("customers")
      .select("id")
      .eq("phone_normalized", phoneNorm)
      .limit(1);
    if (data && data.length > 0) customerId = data[0]!.id as string;
  }

  // 4. Resolve product_id se já existir cadastrado (não cria draft)
  let productId: string | null = null;
  if (lp.productGatewayId) {
    const { data } = await hub
      .from("products")
      .select("id")
      .filter("gateway_ids->>" + lp.platform, "eq", lp.productGatewayId)
      .maybeSingle();
    if (data) productId = data.id as string;
  }

  // 5. Insere. Tenta com pix_qr_code primeiro (nome novo, pós migration 0032).
  // Se falhar com "column does not exist", retry com expired_qr_code (nome legado)
  // pra não derrubar webhooks durante janela de migração.
  const baseRow = {
    platform: lp.platform,
    kind: lp.kind,
    external_event_id: lp.externalEventId,
    email: lp.email ?? null,
    phone: lp.phone ?? null,
    phone_normalized: phoneNorm,
    customer_id: customerId,
    product_gateway_id: lp.productGatewayId ?? null,
    product_id: productId,
    product_name: lp.productNameHint ?? null,
    offer_name: lp.offerName ?? null,
    amount_cents: lp.amountCents,
    utm_source: lp.utm?.source ?? null,
    utm_medium: lp.utm?.medium ?? null,
    utm_campaign: lp.utm?.campaign ?? null,
    utm_content: lp.utm?.content ?? null,
    utm_term: lp.utm?.term ?? null,
    funnel_ref: lp.funnelRef ?? null,
    event_source_url: lp.eventSourceUrl ?? null,
    payment_method: lp.paymentMethod ?? null,
    occurred_at: lp.occurredAt,
    raw_payload: lp.rawPayload ?? null,
  };

  let inserted: { id: unknown } | null = null;
  let error: { message?: string; code?: string } | null = null;

  // Primeira tentativa: nome novo
  {
    const r = await hub
      .from("lost_purchases")
      .insert({ ...baseRow, pix_qr_code: lp.pixQrCode ?? null })
      .select("id")
      .single();
    inserted = (r.data ?? null) as { id: unknown } | null;
    error = (r.error ?? null) as { message?: string; code?: string } | null;
  }

  // Fallback: se erro menciona "pix_qr_code" não existir, tenta com nome antigo
  if (error && /pix_qr_code/i.test(String(error.message ?? ""))) {
    console.warn("[recordLostPurchase] pix_qr_code missing, falling back to expired_qr_code");
    const r2 = await hub
      .from("lost_purchases")
      .insert({ ...baseRow, expired_qr_code: lp.pixQrCode ?? null })
      .select("id")
      .single();
    inserted = (r2.data ?? null) as { id: unknown } | null;
    error = (r2.error ?? null) as { message?: string; code?: string } | null;
  }

  if (error || !inserted) {
    console.error("[recordLostPurchase] insert failed:", error);
    return { skipped: true, reason: "insert_failed" };
  }

  await logEvent(hub, "lost_purchase.recorded", {
    payload: {
      platform: lp.platform,
      kind: lp.kind,
      external_event_id: lp.externalEventId,
      email: lp.email,
      amount_cents: lp.amountCents,
    },
    customerId: customerId ?? undefined,
  });

  return { skipped: false, id: inserted.id as string };
}

/**
 * Quando uma purchase nova é registrada, marca lost_purchases do mesmo
 * external_event_id (tx_id) como resolved=true. Isso fecha o lifecycle:
 * pix_pending + pix_expired daquele tx viram resolved.
 *
 * NÃO faz match por email/phone (Fase 1) — só por tx_id direto.
 */
async function markLostResolvedByTxId(
  hub: SupabaseClient,
  platform: Gateway,
  externalEventId: string,
): Promise<void> {
  await hub
    .from("lost_purchases")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("platform", platform)
    .eq("external_event_id", externalEventId)
    .eq("resolved", false);
}

export { revokeGrantsForPurchase, markLostResolvedByTxId };
export const GRACE_DAYS = GRACE_PERIOD_DAYS;
