/**
 * Entrega de outbound_deliveries — POST pro destino + atualização de status.
 *
 * Usado em 2 lugares:
 *   - Inline no route do Respondi (entrega IMEDIATA, best-effort) → sem esperar o cron.
 *   - No cron /api/cron/process-jobs (rede de segurança / retry com backoff).
 *
 * Sempre best-effort: nunca lança. Em falha, deixa a row 'pending' (até atingir
 * MAX_JOB_ATTEMPTS → 'failed') pra o cron tentar de novo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_JOB_ATTEMPTS } from "@hub/shared";

export interface DeliveryRow {
  id: string;
  url: string;
  payload: unknown;
  event: string | null;
  attempts: number;
}

export type DeliveryResult = "success" | "pending" | "failed";

/** Faz o POST de UMA delivery e atualiza a row. Não lança. */
export async function attemptDelivery(
  hub: SupabaseClient,
  row: DeliveryRow,
): Promise<DeliveryResult> {
  const attempts = (row.attempts ?? 0) + 1;
  const event = row.event ?? "survey.application";
  try {
    const rawBody = JSON.stringify(row.payload ?? {});
    const res = await fetch(row.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "HubGeracaoA-Webhooks/1.0",
        "X-Hub-Event": event,
      },
      body: rawBody,
      signal: AbortSignal.timeout(15_000),
    });
    const respText = (await res.text().catch(() => "")).slice(0, 2000);

    if (res.status >= 200 && res.status < 300) {
      await hub
        .from("outbound_deliveries")
        .update({
          status: "success",
          http_status: res.status,
          response_body: respText,
          attempts,
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return "success";
    }
    throw new Error(`http_${res.status}: ${respText.slice(0, 200)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const finalStatus: DeliveryResult = attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending";
    const backoffMin = Math.min(60, Math.pow(2, attempts));
    await hub
      .from("outbound_deliveries")
      .update({
        status: finalStatus,
        attempts,
        last_error: msg.slice(0, 500),
        run_after: new Date(Date.now() + backoffMin * 60_000).toISOString(),
      })
      .eq("id", row.id);
    return finalStatus;
  }
}
