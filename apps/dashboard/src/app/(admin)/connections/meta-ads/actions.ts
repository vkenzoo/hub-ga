"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { validateToken } from "@/lib/meta/validate-token";
import { decryptCredentials } from "@/lib/meta/conn-credentials";

async function requireMetaAccess() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    redirect("/?error=no_access");
  }
  return auth;
}

function backTo(extra: string): string {
  return `/connections/meta-ads?${extra}`;
}

/**
 * Conecta um BM novo:
 *   1. Lê 4 campos do form
 *   2. Valida via Graph API (4 chamadas)
 *   3. Criptografa app_secret + access_token
 *   4. Upsert em meta_connections (UNIQUE por business_manager_id)
 *   5. Upsert em ad_accounts (todas as contas descobertas)
 *   6. Audit + revalidate
 */
export async function connectMetaBM(formData: FormData) {
  const me = await requireMetaAccess();
  const sb = createSupabaseAdmin();

  const app_id = String(formData.get("app_id") ?? "").trim();
  const app_secret = String(formData.get("app_secret") ?? "").trim();
  const business_manager_id = String(formData.get("business_manager_id") ?? "").trim();
  const access_token = String(formData.get("access_token") ?? "").trim();

  if (!app_id || !app_secret || !business_manager_id || !access_token) {
    redirect(backTo("error=missing_fields"));
  }

  // 1. Valida no Graph API
  const result = await validateToken(access_token, business_manager_id, app_secret);
  if (!result.ok) {
    const params = new URLSearchParams({ error: result.error });
    if (result.detail) params.set("detail", result.detail);
    redirect(backTo(params.toString()));
  }

  // 2. Criptografa
  const access_token_ciphertext = encrypt(access_token);
  const app_secret_ciphertext = encrypt(app_secret);

  // 3. Upsert da conexão (UNIQUE por business_manager_id)
  const { data: conn, error: connErr } = await sb
    .from("meta_connections")
    .upsert(
      {
        business_manager_id: result.business_manager_id,
        business_manager_name: result.business_manager_name,
        app_id,
        app_secret_ciphertext,
        access_token_ciphertext,
        granted_scopes: result.granted_scopes,
        fb_user_id: result.fb_user_id,
        fb_user_name: result.fb_user_name,
        expires_at: null,
        status: "active",
        connection_type: "system_user",
        last_synced_at: new Date().toISOString(),
        last_healthcheck_at: new Date().toISOString(),
        last_error: null,
        created_by_email: me.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_manager_id" },
    )
    .select("id")
    .single();

  if (connErr || !conn) {
    console.error("[connectMetaBM] insert failed:", connErr);
    redirect(backTo("error=insert_failed"));
  }

  // 4. Upsert das ad accounts (UNIQUE por meta_connection_id + account_id)
  if (result.ad_accounts.length > 0) {
    const rows = result.ad_accounts.map((acc) => ({
      meta_connection_id: conn.id,
      account_id: acc.id,
      name: acc.name,
      currency: acc.currency,
      timezone_name: acc.timezone_name,
      account_status: acc.account_status,
      balance_cents: acc.balance_cents,
      amount_spent_cents: acc.amount_spent_cents,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    await sb.from("ad_accounts").upsert(rows, {
      onConflict: "meta_connection_id,account_id",
    });
  }

  await logAudit({
    actor: me.email,
    action: "meta.connect",
    target: conn.id as string,
    payload: {
      business_manager_id: result.business_manager_id,
      business_manager_name: result.business_manager_name,
      ad_accounts_count: result.ad_accounts.length,
    },
  });

  revalidatePath("/connections");
  revalidatePath("/connections/meta-ads");
  redirect(
    backTo(
      `saved=${encodeURIComponent(result.business_manager_name)}&accounts=${result.ad_accounts.length}`,
    ),
  );
}

/**
 * Healthcheck — re-valida o token e atualiza ad_accounts.
 * Útil pra:
 *   - Confirmar que token continua válido após mudanças
 *   - Importar contas que foram adicionadas ao BM depois da conexão inicial
 *   - Detectar revogação manual no painel Meta
 */
export async function healthcheckMetaBM(formData: FormData) {
  const me = await requireMetaAccess();
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) redirect(backTo("error=missing_fields"));

  const { data: conn, error: connErr } = await sb
    .from("meta_connections")
    .select(
      "id, business_manager_id, app_id, app_secret_ciphertext, access_token_ciphertext",
    )
    .eq("id", id)
    .maybeSingle();

  if (connErr || !conn) redirect(backTo("error=not_found"));

  const { token, appSecret } = decryptCredentials(conn);
  const result = await validateToken(token, conn.business_manager_id, appSecret);

  if (!result.ok) {
    await sb
      .from("meta_connections")
      .update({
        status: result.error === "invalid_token" ? "invalid" : "active",
        last_healthcheck_at: new Date().toISOString(),
        last_error: `${result.error}${result.detail ? `: ${result.detail}` : ""}`,
      })
      .eq("id", id);

    await logAudit({
      actor: me.email,
      action: "meta.healthcheck.failed",
      target: id,
      payload: { error: result.error, detail: result.detail },
    });

    const params = new URLSearchParams({ error: result.error });
    if (result.detail) params.set("detail", result.detail);
    redirect(backTo(params.toString()));
  }

  // Sucesso — atualiza nome do BM (pode ter mudado), scopes, last_healthcheck_at
  await sb
    .from("meta_connections")
    .update({
      business_manager_name: result.business_manager_name,
      granted_scopes: result.granted_scopes,
      fb_user_id: result.fb_user_id,
      fb_user_name: result.fb_user_name,
      status: "active",
      last_healthcheck_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id);

  // Re-importa ad accounts (pode ter contas novas)
  if (result.ad_accounts.length > 0) {
    const rows = result.ad_accounts.map((acc) => ({
      meta_connection_id: id,
      account_id: acc.id,
      name: acc.name,
      currency: acc.currency,
      timezone_name: acc.timezone_name,
      account_status: acc.account_status,
      balance_cents: acc.balance_cents,
      amount_spent_cents: acc.amount_spent_cents,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    await sb.from("ad_accounts").upsert(rows, {
      onConflict: "meta_connection_id,account_id",
    });
  }

  await logAudit({
    actor: me.email,
    action: "meta.healthcheck.ok",
    target: id,
    payload: {
      business_manager_id: result.business_manager_id,
      ad_accounts_count: result.ad_accounts.length,
    },
  });

  revalidatePath("/connections/meta-ads");
  redirect(backTo(`checked=${encodeURIComponent(result.business_manager_name)}`));
}

/**
 * Remove conexão (cascade apaga ad_accounts e futuras meta_ad_insights_daily).
 */
export async function deleteMetaBM(formData: FormData) {
  const me = await requireMetaAccess();
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) redirect(backTo("error=missing_fields"));

  const { data: before } = await sb
    .from("meta_connections")
    .select("business_manager_id, business_manager_name")
    .eq("id", id)
    .maybeSingle();

  await sb.from("meta_connections").delete().eq("id", id);

  await logAudit({
    actor: me.email,
    action: "meta.delete",
    target: id,
    payload: { previous: before ?? null },
  });

  revalidatePath("/connections");
  revalidatePath("/connections/meta-ads");
  redirect(
    backTo(
      `removed=${encodeURIComponent(before?.business_manager_name ?? before?.business_manager_id ?? id)}`,
    ),
  );
}
