/**
 * Forward de respostas de formulários de APLICAÇÃO pro GoHighLevel (ou qualquer
 * destino configurado em outbound_webhooks subscrito ao evento 'survey.application').
 *
 * Fluxo:
 *   1. Respondi envia resposta → route grava survey_response.
 *   2. Se o form é de aplicação (nome contém "aplica"), chama enqueueSurveyForward.
 *   3. Cria 1 outbound_deliveries (status pending) por destino ativo.
 *   4. Cron /api/cron/process-jobs faz o POST e atualiza status (success/failed,
 *      com retry + backoff).
 *
 * O hub NÃO qualifica — só repassa email/phone/nome/UTMs/answers. O GHL qualifica.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { attemptDelivery } from "./deliveries";

const SURVEY_APPLICATION_EVENT = "survey.application";

/** Normaliza: minúsculo, sem acento. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Form é de aplicação quando o nome contém "aplica" (aplicação/aplicacao). */
export function isApplicationForm(formName: string | null | undefined): boolean {
  if (!formName) return false;
  return normalize(formName).includes("aplica");
}

export interface SurveyForwardData {
  surveyResponseId: string;
  formId: string;
  formName: string | null;
  respondentId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  score: number | null;
  utms: Record<string, string>;
  answers: Record<string, unknown>;
  receivedAt: string;
}

/**
 * Cria 1 outbound_deliveries (pending) por destino ativo subscrito a
 * 'survey.application'. Não posta — o cron drena. Retorna quantos foram enfileirados.
 */
export async function enqueueSurveyForward(
  hub: SupabaseClient,
  data: SurveyForwardData,
): Promise<{ enqueued: number }> {
  const { data: subs, error } = await hub
    .from("outbound_webhooks")
    .select("id, label, url, active, form_filter")
    .eq("active", true)
    .contains("events", [SURVEY_APPLICATION_EVENT]);

  if (error) {
    console.error("[survey-forward] lookup failed:", error);
    return { enqueued: 0 };
  }

  // Roteamento por formulário: cada destino só recebe respostas de forms cujo
  // nome (normalizado) CONTÉM o form_filter dele. Sem filtro (null) → não recebe
  // forward de form (evita broadcast acidental).
  const formName = normalize(data.formName ?? "");
  const allSubs = (subs ?? []) as Array<{
    id: string;
    label: string;
    url: string;
    form_filter: string | null;
  }>;
  const destinations = allSubs.filter((d) => {
    if (!d.form_filter) return false;
    return formName.includes(normalize(d.form_filter));
  });
  if (destinations.length === 0) return { enqueued: 0 };

  const payload = {
    source: "respondi",
    event: SURVEY_APPLICATION_EVENT,
    form_id: data.formId,
    form_name: data.formName,
    respondent_id: data.respondentId,
    email: data.email,
    phone: data.phone,
    name: data.name,
    score: data.score,
    utms: data.utms,
    answers: data.answers,
    received_at: data.receivedAt,
  };

  const rows = destinations.map((d) => ({
    destination: d.label,
    event: SURVEY_APPLICATION_EVENT,
    source_ref: data.surveyResponseId,
    url: d.url,
    payload,
    status: "pending" as const,
    attempts: 0,
  }));

  const { data: inserted, error: insErr } = await hub
    .from("outbound_deliveries")
    .insert(rows)
    .select("id, url, payload, event, attempts");
  if (insErr) {
    console.error("[survey-forward] insert deliveries failed:", insErr);
    return { enqueued: 0 };
  }

  // Entrega IMEDIATA (best-effort) — não espera o cron. Se falhar, fica pending
  // e o cron tenta de novo com backoff. attemptDelivery nunca lança.
  const created = (inserted ?? []) as Array<{
    id: string; url: string; payload: unknown; event: string | null; attempts: number;
  }>;
  await Promise.all(created.map((d) => attemptDelivery(hub, d)));

  return { enqueued: created.length };
}
