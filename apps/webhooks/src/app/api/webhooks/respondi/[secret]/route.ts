import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { timingSafeEqual } from "node:crypto";
import { extractEmail, extractPhone, classifyResponse, type QualificationRule } from "@/lib/surveys";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-11);
}

interface RespondiPayload {
  form?: { form_id?: string; form_name?: string };
  respondent?: {
    respondent_id?: string;
    date?: string;
    score?: number;
    status?: string;
    respondent_utms?: Record<string, string>;
    answers?: Record<string, unknown>;
    raw_answers?: Array<{
      question_id?: string;
      question?: string;
      answer?: string | string[];
      value?: string;
    }>;
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret: pathSecret } = await params;
  const expectedSecret = process.env.RESPONDI_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (!safeEqualString(pathSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: RespondiPayload;
  try {
    payload = (await req.json()) as RespondiPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hub = createHubServiceClient();

  const formId = payload.form?.form_id;
  const respondentId = payload.respondent?.respondent_id;

  if (!formId || !respondentId) {
    await logEvent(hub, "respondi.invalid_payload", {
      level: "warn",
      payload: { reason: "missing_form_or_respondent", body: payload },
    });
    return NextResponse.json({ ok: true, ignored: "missing_form_or_respondent" }, { status: 200 });
  }

  // Dedup por (respondent_id, form_id) — se já recebeu, ignora
  const { data: existing } = await hub
    .from("survey_responses")
    .select("id")
    .eq("respondi_respondent_id", respondentId)
    .eq("form_id", formId)
    .maybeSingle();

  if (existing) {
    await logEvent(hub, "respondi.duplicate", {
      level: "info",
      payload: { respondent_id: respondentId, form_id: formId },
    });
    return NextResponse.json({ ok: true, ignored: "duplicate" }, { status: 200 });
  }

  const answers = (payload.respondent?.answers ?? {}) as Record<string, unknown>;
  const rawAnswers = payload.respondent?.raw_answers ?? [];
  const email = extractEmail(answers, rawAnswers);
  const phone = extractPhone(answers, rawAnswers);
  const phoneNorm = normalizePhone(phone);

  // Tenta linkar customer existente por email primeiro, depois phone normalizado
  let customerId: string | null = null;
  if (email) {
    const { data } = await hub.from("customers").select("id").eq("email", email).maybeSingle();
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

  // Carrega regras de qualificação ativas (global + do form específico)
  const { data: rulesData } = await hub
    .from("lead_qualification_rules")
    .select("*")
    .eq("active", true)
    .or(`form_id.is.null,form_id.eq.${formId}`)
    .order("created_at", { ascending: true });

  const rules = (rulesData ?? []) as unknown as QualificationRule[];
  const qualification = classifyResponse(answers, rules, formId);

  const utms = payload.respondent?.respondent_utms ?? {};

  const { error: insErr } = await hub.from("survey_responses").insert({
    respondi_respondent_id: respondentId,
    form_id: formId,
    form_name: payload.form?.form_name ?? null,
    email,
    phone,
    score: payload.respondent?.score ?? null,
    utm_source: utms.utm_source ?? null,
    utm_medium: utms.utm_medium ?? null,
    utm_campaign: utms.utm_campaign ?? null,
    utm_content: utms.utm_content ?? null,
    utm_term: utms.utm_term ?? null,
    answers,
    raw_answers: rawAnswers,
    raw_payload: payload,
    qualification,
    customer_id: customerId,
  });

  if (insErr) {
    console.error("[respondi] insert failed:", insErr);
    await logEvent(hub, "respondi.insert_failed", {
      level: "error",
      payload: { error: insErr.message, respondent_id: respondentId, form_id: formId },
    });
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  await logEvent(hub, "respondi.received", {
    payload: {
      respondent_id: respondentId,
      form_id: formId,
      qualification,
      has_email: !!email,
      has_phone: !!phone,
      customer_matched: !!customerId,
    },
    customerId: customerId ?? undefined,
  });

  return NextResponse.json({ ok: true, qualification, customer_matched: !!customerId }, { status: 200 });
}
