"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

type Tab = "meta_ads" | "inlead" | "cademi" | "outbound";

async function requireConnections() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    redirect("/?error=no_access");
  }
  return auth;
}

function generateSecret(len = 32): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function tabRedirect(tab: Tab, extra?: string): string {
  return `/connections?tab=${tab}${extra ? "&" + extra : ""}`;
}

// ── Meta Ads ────────────────────────────────────────────────────

export async function createMetaAds(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const app_id = String(formData.get("app_id") ?? "").trim();
  const app_secret = String(formData.get("app_secret") ?? "").trim();
  const business_manager_id = String(formData.get("business_manager_id") ?? "").trim();
  const access_token = String(formData.get("access_token") ?? "").trim();

  if (!label || !app_id || !app_secret || !business_manager_id || !access_token) {
    redirect(tabRedirect("meta_ads", "error=missing_fields"));
  }

  const { data, error } = await sb
    .from("connections")
    .insert({
      kind: "meta_ads",
      label,
      status: "pending",
      config: { app_id, app_secret, business_manager_id, access_token },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[connections] meta_ads insert failed:", error);
    redirect(tabRedirect("meta_ads", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "connection.create",
    target: data.id as string,
    payload: { kind: "meta_ads", label, business_manager_id },
  });

  revalidatePath("/connections");
  redirect(tabRedirect("meta_ads", `saved=${encodeURIComponent(label)}`));
}

// ── InLead ──────────────────────────────────────────────────────

export async function createInLead(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect(tabRedirect("inlead", "error=missing_label"));

  const secret = generateSecret(40);

  const { data, error } = await sb
    .from("connections")
    .insert({
      kind: "inlead",
      label,
      status: "pending",
      config: { secret },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[connections] inlead insert failed:", error);
    redirect(tabRedirect("inlead", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "connection.create",
    target: data.id as string,
    payload: { kind: "inlead", label },
  });

  revalidatePath("/connections");
  redirect(tabRedirect("inlead", `saved=${encodeURIComponent(label)}`));
}

// ── Cademí ──────────────────────────────────────────────────────

export async function createCademi(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const api_key = String(formData.get("api_key") ?? "").trim();

  if (!label || !api_key) {
    redirect(tabRedirect("cademi", "error=missing_fields"));
  }

  const { data, error } = await sb
    .from("connections")
    .insert({
      kind: "cademi",
      label,
      status: "pending",
      config: { api_key },
    })
    .select("id")
    .single();

  if (error) {
    console.error("[connections] cademi insert failed:", error);
    redirect(tabRedirect("cademi", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "connection.create",
    target: data.id as string,
    payload: { kind: "cademi", label },
  });

  revalidatePath("/connections");
  redirect(tabRedirect("cademi", `saved=${encodeURIComponent(label)}`));
}

// ── Conexão (qualquer kind) ─────────────────────────────────────

export async function deleteConnection(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");
  const tab = (String(formData.get("tab") ?? "meta_ads") as Tab);

  const { data: before } = await sb
    .from("connections")
    .select("kind, label")
    .eq("id", id)
    .maybeSingle();

  await sb.from("connections").delete().eq("id", id);

  await logAudit({
    actor: me.email,
    action: "connection.delete",
    target: id,
    payload: { previous: before ?? null },
  });

  revalidatePath("/connections");
  redirect(tabRedirect(tab, `removed=${encodeURIComponent(before?.label ?? id)}`));
}

// ── Outbound webhooks ───────────────────────────────────────────

export async function createOutbound(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const events = formData.getAll("events").map(String);

  if (!label || !url) redirect(tabRedirect("outbound", "error=missing_fields"));
  if (!url.startsWith("https://")) redirect(tabRedirect("outbound", "error=invalid_url"));
  if (events.length === 0) redirect(tabRedirect("outbound", "error=no_events"));

  const secret = generateSecret(40);

  const { data, error } = await sb
    .from("outbound_webhooks")
    .insert({ label, url, events, secret, active: true })
    .select("id")
    .single();

  if (error) {
    console.error("[connections] outbound insert failed:", error);
    redirect(tabRedirect("outbound", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "outbound.create",
    target: data.id as string,
    payload: { label, url, events },
  });

  revalidatePath("/connections");
  redirect(
    tabRedirect(
      "outbound",
      `saved=${encodeURIComponent(label)}&new_secret=${encodeURIComponent(secret)}&new_id=${data.id}`,
    ),
  );
}

export async function toggleOutbound(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");

  const { data: current } = await sb
    .from("outbound_webhooks")
    .select("active, label")
    .eq("id", id)
    .maybeSingle();

  const next = !(current?.active ?? true);

  await sb.from("outbound_webhooks").update({ active: next, updated_at: new Date().toISOString() }).eq("id", id);

  await logAudit({
    actor: me.email,
    action: "outbound.toggle",
    target: id,
    payload: { label: current?.label, active: next },
  });

  revalidatePath("/connections");
  redirect(tabRedirect("outbound"));
}

export async function deleteOutbound(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");

  const { data: before } = await sb
    .from("outbound_webhooks")
    .select("label, url, events")
    .eq("id", id)
    .maybeSingle();

  await sb.from("outbound_webhooks").delete().eq("id", id);

  await logAudit({
    actor: me.email,
    action: "outbound.delete",
    target: id,
    payload: { previous: before ?? null },
  });

  revalidatePath("/connections");
  redirect(tabRedirect("outbound", `removed=${encodeURIComponent(before?.label ?? id)}`));
}
