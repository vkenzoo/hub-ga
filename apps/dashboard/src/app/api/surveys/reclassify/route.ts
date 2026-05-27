/**
 * POST /api/surveys/reclassify
 *
 * Reprocessa qualification em todas as survey_responses sem classificação.
 * Auth via session de admin (canAccessSection surveys).
 */
import { NextResponse } from "next/server";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { classifyResponse, type QualificationRule } from "@/lib/surveys/classify";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const hub = createSupabaseAdmin();

  // 0. Re-linka customer_id em survey_responses que ficaram sem match.
  // Comum quando a venda chegou DEPOIS da resposta (ou foi reprocessada).
  let relinkedByEmail = 0;
  let relinkedByPhone = 0;
  const { data: unlinkedResp } = await hub
    .from("survey_responses")
    .select("id, email, phone")
    .is("customer_id", null)
    .limit(5000);

  for (const r of (unlinkedResp ?? []) as Array<{ id: string; email: string | null; phone: string | null }>) {
    let customerId: string | null = null;
    if (r.email) {
      const { data } = await hub
        .from("customers")
        .select("id")
        .ilike("email", r.email)
        .maybeSingle();
      if (data) {
        customerId = data.id as string;
        relinkedByEmail++;
      }
    }
    if (!customerId && r.phone) {
      const digits = r.phone.replace(/\D/g, "").slice(-11);
      if (digits.length >= 10) {
        const { data } = await hub
          .from("customers")
          .select("id")
          .eq("phone_normalized", digits)
          .limit(1);
        if (data && data.length > 0) {
          customerId = data[0]!.id as string;
          relinkedByPhone++;
        }
      }
    }
    if (customerId) {
      await hub.from("survey_responses").update({ customer_id: customerId }).eq("id", r.id);
    }
  }

  // 1. Carrega regras ativas
  const { data: rulesData, error: rulesErr } = await hub
    .from("lead_qualification_rules")
    .select("question_key, match_type, answer_pattern, classification, active, form_id")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (rulesErr) {
    return NextResponse.json(
      { error: "rules_query_failed", detail: rulesErr.message },
      { status: 500 },
    );
  }

  const rules = (rulesData ?? []) as QualificationRule[];
  if (rules.length === 0) {
    return NextResponse.json({ ok: true, message: "Sem regras ativas, nada pra reclassificar.", processed: 0, classified: 0 });
  }

  // 2. Carrega respostas com qualification = null (últimas 5000)
  const { data: responses, error } = await hub
    .from("survey_responses")
    .select("id, form_id, answers")
    .is("qualification", null)
    .order("received_at", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 },
    );
  }

  type Row = {
    id: string;
    form_id: string;
    answers: Record<string, unknown>;
  };
  const rows = (responses ?? []) as Row[];

  let processed = 0;
  let classified = 0;

  for (const r of rows) {
    const result = classifyResponse(r.answers ?? {}, rules, r.form_id);
    if (result !== null) {
      const { error: upErr } = await hub
        .from("survey_responses")
        .update({ qualification: result })
        .eq("id", r.id);
      if (!upErr) classified++;
    }
    processed++;
  }

  await logAudit({
    actor: auth.email,
    action: "surveys.reclassify",
    target: "survey_responses",
    payload: {
      rules_count: rules.length,
      processed,
      classified,
      relinked_by_email: relinkedByEmail,
      relinked_by_phone: relinkedByPhone,
    },
  });

  revalidatePath("/surveys");

  return NextResponse.json({
    ok: true,
    processed,
    classified,
    relinked_by_email: relinkedByEmail,
    relinked_by_phone: relinkedByPhone,
  });
}
