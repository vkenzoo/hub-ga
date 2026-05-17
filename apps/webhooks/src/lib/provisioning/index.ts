import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWelcomeEmail } from "@hub/email";
import { GRACE_PERIOD_DAYS } from "@hub/shared";
import { createSystemUser } from "./create-system-user";
import { logEvent } from "../logger";

type DurationMode = "lifetime" | "follow_subscription" | "fixed_days";

interface EntitlementRow {
  id: string;
  kind: "system_access" | "cademi_course";
  system_id: string | null;
  tier: string | null;
  cademi_course_id: string | null;
  duration_mode: DurationMode;
  duration_days: number | null;
}

interface SystemRow {
  id: string;
  slug: string;
  name: string;
  base_app_url: string;
}

interface ProductRow {
  id: string;
  name: string;
  requires_app_access: boolean;
}

interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
}

interface SubscriptionRow {
  id: string;
  gateway_subscription_id: string;
  current_period_end: string | null;
}

function computeExpiry(ent: EntitlementRow, subscription: SubscriptionRow | null): string | null {
  if (ent.duration_mode === "lifetime") return null;
  if (ent.duration_mode === "fixed_days" && ent.duration_days && ent.duration_days > 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ent.duration_days);
    return d.toISOString();
  }
  if (ent.duration_mode === "follow_subscription" && subscription?.current_period_end) {
    return subscription.current_period_end;
  }
  // Sem assinatura conhecida → grant indefinido (será definido quando renovação chegar)
  return null;
}

export async function provisionForPurchase(
  hub: SupabaseClient,
  customerId: string,
  productId: string,
  purchaseId: string,
  opts: { gateway?: "assiny" | "hotmart"; gatewaySubscriptionId?: string } = {},
): Promise<void> {
  const [{ data: customer }, { data: product }, { data: entitlements }] = await Promise.all([
    hub.from("customers").select("id,email,name").eq("id", customerId).maybeSingle(),
    hub.from("products").select("id,name,requires_app_access").eq("id", productId).maybeSingle(),
    hub
      .from("entitlements")
      .select("id,kind,system_id,tier,cademi_course_id,duration_mode,duration_days")
      .eq("product_id", productId),
  ]);

  if (!customer || !product || !entitlements || entitlements.length === 0) {
    await logEvent(hub, "provisioning.skipped", {
      level: "warn",
      payload: { reason: "missing_data", customerId, productId },
      customerId,
      purchaseId,
    });
    return;
  }

  const customerRow = customer as CustomerRow;
  const productRow = product as ProductRow;

  // Resolve subscription (se essa compra criou uma)
  let subscription: SubscriptionRow | null = null;
  if (opts.gateway && opts.gatewaySubscriptionId) {
    const { data } = await hub
      .from("subscriptions")
      .select("id,gateway_subscription_id,current_period_end")
      .eq("gateway", opts.gateway)
      .eq("gateway_subscription_id", opts.gatewaySubscriptionId)
      .maybeSingle();
    if (data) subscription = data as SubscriptionRow;
  }

  // Mapa system_id → system
  const systemIds = (entitlements as EntitlementRow[])
    .map((e) => e.system_id)
    .filter((id): id is string => !!id);
  const systemsById = new Map<string, SystemRow>();
  if (systemIds.length > 0) {
    const { data: systems } = await hub
      .from("systems")
      .select("id,slug,name,base_app_url")
      .in("id", systemIds);
    for (const s of (systems ?? []) as SystemRow[]) systemsById.set(s.id, s);
  }

  const password = process.env.DEFAULT_PROVISION_PASSWORD ?? "";

  for (const ent of entitlements as EntitlementRow[]) {
    // Dedupe grant
    const { data: existingGrant } = await hub
      .from("access_grants")
      .select("id")
      .eq("customer_id", customerRow.id)
      .eq("entitlement_id", ent.id)
      .eq("source_purchase_id", purchaseId)
      .maybeSingle();

    if (!existingGrant) {
      const expires_at = computeExpiry(ent, subscription);
      await hub.from("access_grants").insert({
        customer_id: customerRow.id,
        entitlement_id: ent.id,
        source_purchase_id: purchaseId,
        subscription_id: subscription?.id ?? null,
        expires_at,
      });
    }

    if (ent.kind === "system_access" && ent.system_id) {
      const system = systemsById.get(ent.system_id);
      if (!system) continue;

      const result = await createSystemUser(system.slug, customerRow.email);
      await logEvent(hub, "provisioning.system_user", {
        level: result.error ? "error" : "info",
        payload: {
          system: system.slug,
          email: customerRow.email,
          tier: ent.tier,
          created: result.created,
          alreadyExisted: result.alreadyExisted,
          error: result.error ?? null,
        },
        customerId: customerRow.id,
        purchaseId,
      });

      if (result.error) {
        await hub.from("pending_jobs").insert({
          kind: "provision_user",
          payload: {
            customerId: customerRow.id,
            productId: productRow.id,
            purchaseId,
            systemSlug: system.slug,
            email: customerRow.email,
          },
          last_error: result.error,
          status: "queued",
        });
        continue;
      }

      if (result.created) {
        try {
          const emailResult = await sendWelcomeEmail({
            to: customerRow.email,
            customerName: customerRow.name,
            productName: productRow.name,
            systemName: system.name,
            loginUrl: system.base_app_url,
            password,
          });
          await logEvent(hub, "provisioning.welcome_email", {
            payload: { system: system.slug, email: customerRow.email, result: emailResult },
            customerId: customerRow.id,
            purchaseId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await logEvent(hub, "provisioning.welcome_email_failed", {
            level: "error",
            payload: { system: system.slug, email: customerRow.email, error: msg },
            customerId: customerRow.id,
            purchaseId,
          });
        }
      }
    }
  }
}

/**
 * Estende expires_at dos grants vinculados a uma assinatura ativa renovada.
 */
export async function extendGrantsOnRenewal(
  hub: SupabaseClient,
  subscriptionId: string,
  newPeriodEnd: string,
): Promise<void> {
  const { error } = await hub
    .from("access_grants")
    .update({ expires_at: newPeriodEnd })
    .eq("subscription_id", subscriptionId);

  await logEvent(hub, "provisioning.renewal", {
    level: error ? "error" : "info",
    payload: { subscriptionId, newPeriodEnd, error: error?.message ?? null },
  });
}

/**
 * past_due: aplica grace period. cancelled: deixa rodar até current_period_end.
 */
export async function adjustGrantsOnSubscriptionStatus(
  hub: SupabaseClient,
  subscriptionId: string,
  status: "past_due" | "cancelled",
  currentPeriodEnd: string | null,
): Promise<void> {
  let expires_at: string;
  if (status === "past_due") {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + GRACE_PERIOD_DAYS);
    expires_at = d.toISOString();
  } else {
    // cancelled: cliente paga até o fim do ciclo
    expires_at = currentPeriodEnd ?? new Date().toISOString();
  }

  const { error } = await hub
    .from("access_grants")
    .update({ expires_at })
    .eq("subscription_id", subscriptionId);

  await logEvent(hub, "provisioning.subscription_status", {
    level: error ? "error" : "info",
    payload: { subscriptionId, status, expires_at, error: error?.message ?? null },
  });
}

/**
 * Revoga imediatamente em refund/chargeback (grants vinculados à purchase).
 */
export async function revokeGrantsForPurchase(
  hub: SupabaseClient,
  purchaseId: string,
  options: { graceDays?: number } = {},
): Promise<void> {
  const expiresAt = new Date();
  if (options.graceDays && options.graceDays > 0) {
    expiresAt.setUTCDate(expiresAt.getUTCDate() + options.graceDays);
  }

  const { error } = await hub
    .from("access_grants")
    .update({ expires_at: expiresAt.toISOString() })
    .eq("source_purchase_id", purchaseId);

  await logEvent(hub, "provisioning.revoke", {
    level: error ? "error" : "info",
    payload: {
      purchaseId,
      graceDays: options.graceDays ?? 0,
      expiresAt: expiresAt.toISOString(),
      error: error?.message ?? null,
    },
    purchaseId,
  });
}
