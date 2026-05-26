/**
 * POST /api/meta/healthcheck/[id]
 *
 * Re-valida token + re-importa ad accounts. Equivalente ao botão "Verificar".
 */
import { NextResponse } from "next/server";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { decryptCredentials } from "@/lib/meta/conn-credentials";
import { validateToken } from "@/lib/meta/validate-token";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const sb = createSupabaseAdmin();
  const { data: conn } = await sb
    .from("meta_connections")
    .select("id, business_manager_id, app_secret_ciphertext, access_token_ciphertext")
    .eq("id", id)
    .maybeSingle();

  if (!conn) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let token: string;
  let appSecret: string;
  try {
    const creds = decryptCredentials(conn);
    token = creds.token;
    appSecret = creds.appSecret;
  } catch (e) {
    return NextResponse.json(
      { error: "encryption_misconfigured", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

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
      actor: auth.email,
      action: "meta.healthcheck.failed",
      target: id,
      payload: { error: result.error, detail: result.detail },
    });

    return NextResponse.json({ ok: false, error: result.error, detail: result.detail });
  }

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

  if (result.ad_accounts.length > 0) {
    await sb.from("ad_accounts").upsert(
      result.ad_accounts.map((acc) => ({
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
      })),
      { onConflict: "meta_connection_id,account_id" },
    );
  }

  await logAudit({
    actor: auth.email,
    action: "meta.healthcheck.ok",
    target: id,
    payload: {
      business_manager_id: result.business_manager_id,
      ad_accounts_count: result.ad_accounts.length,
    },
  });

  revalidatePath("/connections/meta-ads");

  return NextResponse.json({
    ok: true,
    business_manager_name: result.business_manager_name,
    ad_accounts_count: result.ad_accounts.length,
  });
}
