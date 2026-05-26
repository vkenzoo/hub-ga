"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

type Section = "meta-ads" | "inlead" | "cademi" | "outbound";

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

function sectionRedirect(section: Section, extra?: string): string {
  return `/connections/${section}${extra ? "?" + extra : ""}`;
}

// Meta Ads agora vive em meta-ads/actions.ts (usa meta_connections + ad_accounts).

// ── InLead ──────────────────────────────────────────────────────

export async function createInLead(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect(sectionRedirect("inlead", "error=missing_label"));

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
    redirect(sectionRedirect("inlead", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "connection.create",
    target: data.id as string,
    payload: { kind: "inlead", label },
  });

  revalidatePath("/connections");
  redirect(sectionRedirect("inlead", `saved=${encodeURIComponent(label)}`));
}

// ── Cademí ──────────────────────────────────────────────────────

export async function createCademi(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const api_key = String(formData.get("api_key") ?? "").trim();

  if (!label || !api_key) {
    redirect(sectionRedirect("cademi", "error=missing_fields"));
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
    redirect(sectionRedirect("cademi", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "connection.create",
    target: data.id as string,
    payload: { kind: "cademi", label },
  });

  revalidatePath("/connections");
  redirect(sectionRedirect("cademi", `saved=${encodeURIComponent(label)}`));
}

// ── Conexão (qualquer kind) ─────────────────────────────────────

export async function deleteConnection(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");
  const section = (String(formData.get("section") ?? "meta-ads") as Section);

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
  redirect(sectionRedirect(section, `removed=${encodeURIComponent(before?.label ?? id)}`));
}

// ── Outbound webhooks ───────────────────────────────────────────

export async function createOutbound(formData: FormData) {
  const me = await requireConnections();
  const sb = createSupabaseAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const events = formData.getAll("events").map(String);

  if (!label || !url) redirect(sectionRedirect("outbound", "error=missing_fields"));
  if (!url.startsWith("https://")) redirect(sectionRedirect("outbound", "error=invalid_url"));
  if (events.length === 0) redirect(sectionRedirect("outbound", "error=no_events"));

  const secret = generateSecret(40);

  const { data, error } = await sb
    .from("outbound_webhooks")
    .insert({ label, url, events, secret, active: true })
    .select("id")
    .single();

  if (error) {
    console.error("[connections] outbound insert failed:", error);
    redirect(sectionRedirect("outbound", "error=insert_failed"));
  }

  await logAudit({
    actor: me.email,
    action: "outbound.create",
    target: data.id as string,
    payload: { label, url, events },
  });

  revalidatePath("/connections");
  redirect(
    sectionRedirect(
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
  redirect(sectionRedirect("outbound"));
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
  redirect(sectionRedirect("outbound", `removed=${encodeURIComponent(before?.label ?? id)}`));
}
