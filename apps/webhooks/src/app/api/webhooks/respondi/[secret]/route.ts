import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { timingSafeEqual } from "node:crypto";
import { extractEmail, extractPhone, classifyResponse, type QualificationRule } from "@/lib/surveys";
import { logEvent } from "@/lib/logger";
import { runWithExecution } from "@/lib/execution-context";
import { createExecution, finishExecution, type ExecutionStatus } from "@/lib/executions";

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
  const startedAt = Date.now();
  const rawBody = await req.text();
  const { secret: pathSecret } = await params;
  const expectedSecret = process.env.RESPONDI_WEBHOOK_SECRET;

  const hub = createHubServiceClient();
  const executionId = await createExecution(hub, {
    gateway: "respondi",
    headers: req.headers,
    rawBody,
  });

  async function finish(
    status: ExecutionStatus,
    http: number,
    body: object,
    extras?: Partial<Parameters<typeof finishExecution>[2]>,
  ) {
    if (executionId) {
      await finishExecution(hub, executionId, {
        status,
        httpStatus: http,
        startedAt,
        ...extras,
      });
    }
    return NextResponse.json(body, { status: http });
  }

  return runWithExecution(executionId ?? "no-execution", async () => {
    if (!expectedSecret) {
      return finish("failed", 500, { error: "server_misconfigured" }, {
        errorMessage: "RESPONDI_WEBHOOK_SECRET ausente",
      });
    }

    if (!safeEqualString(pathSecret, expectedSecret)) {
      await logEvent(hub, "respondi.invalid_secret", {
        level: "warn",
        payload: { ip: req.headers.get("x-real-ip") ?? null },
      });
      return finish("rejected_auth", 401, { error: "unauthorized" });
    }

    let payload: RespondiPayload;
    try {
      payload = JSON.parse(rawBody) as RespondiPayload;
    } catch {
      return finish("invalid_payload", 400, { error: "invalid_json" }, {
        errorMessage: "JSON malformado",
      });
    }

    const formId = payload.form?.form_id;
    const respondentId = payload.respondent?.respondent_id;

    if (!formId || !respondentId) {
      await logEvent(hub, "respondi.missing_ids", {
        level: "warn",
        payload: { reason: "missing_form_or_respondent" },
      });
      return finish("invalid_payload", 200, { ok: true, ignored: "missing_form_or_respondent" }, {
        rawEventType: "respondi.response",
        errorMessage: "form_id ou respondent_id ausente",
      });
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
      return finish("duplicate", 200, { ok: true, ignored: "duplicate" }, {
        rawEventType: "respondi.response",
        gatewayEventId: `${respondentId}_${formId}`,
        classifiedAs: "duplicate",
      });
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
      return finish("failed", 500, { error: "insert_failed" }, {
        rawEventType: "respondi.response",
        errorMessage: insErr.message.slice(0, 500),
        gatewayEventId: `${respondentId}_${formId}`,
      });
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

    return finish("completed", 200, {
      ok: true,
      qualification,
      customer_matched: !!customerId,
    }, {
      rawEventType: "respondi.response",
      classifiedAs: qualification ? `lead_${qualification}` : "unclassified",
      gatewayEventId: `${respondentId}_${formId}`,
      customerId: customerId ?? undefined,
    });
  });
}
