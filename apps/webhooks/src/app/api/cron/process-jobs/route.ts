import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { MAX_JOB_ATTEMPTS } from "@hub/shared";
import { createSystemUser } from "@/lib/provisioning/create-system-user";
import { logEvent } from "@/lib/logger";
import { safeEqual } from "@/lib/hmac";
import { dispatchOutboundWebhook, type OutboundEvent } from "@/lib/outbound/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel chama esse endpoint na frequência definida em vercel.json.
// Protegido por CRON_SECRET no header Authorization: Bearer <secret>.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hub = createHubServiceClient();
  const BATCH = 20;

  const { data: jobs, error } = await hub
    .from("pending_jobs")
    .select("id,kind,payload,attempts")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let done = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    const id = job.id as string;
    const attempts = (job.attempts as number) + 1;

    await hub.from("pending_jobs").update({ status: "processing", attempts }).eq("id", id);

    try {
      if (job.kind === "provision_user") {
        const payload = job.payload as { systemSlug: string; email: string };
        const result = await createSystemUser(payload.systemSlug, payload.email);
        if (result.error) throw new Error(result.error);
        await hub
          .from("pending_jobs")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", id);
        done++;
      } else if (job.kind === "outbound_dispatch") {
        const payload = job.payload as {
          webhook_id: string;
          event: OutboundEvent;
          body: { event: OutboundEvent; occurred_at: string; data: Record<string, unknown> };
        };
        await dispatchOutboundWebhook(hub, payload);
        await hub
          .from("pending_jobs")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", id);
        done++;
      } else {
        // job.kind não suportado pela versão atual: marca como done para não loopar
        await hub
          .from("pending_jobs")
          .update({ status: "done", completed_at: new Date().toISOString(), last_error: "unsupported_kind" })
          .eq("id", id);
        done++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const finalStatus = attempts >= MAX_JOB_ATTEMPTS ? "failed" : "queued";
      const backoffMin = Math.min(60, Math.pow(2, attempts));
      const runAfter = new Date(Date.now() + backoffMin * 60_000).toISOString();
      await hub
        .from("pending_jobs")
        .update({
          status: finalStatus,
          last_error: msg,
          run_after: runAfter,
        })
        .eq("id", id);
      await logEvent(hub, "job.failed", {
        level: "error",
        payload: { jobId: id, attempts, error: msg, status: finalStatus },
      });
      failed++;
    }
  }

  // ── Drena outbound_deliveries (fila + log de POSTs pra fora, ex: GHL) ──
  const delivery = await processOutboundDeliveries(hub);

  return NextResponse.json({
    ok: true,
    picked: jobs?.length ?? 0,
    done,
    failed,
    deliveries: delivery,
  });
}

/**
 * Pega outbound_deliveries pendentes, faz POST e atualiza status. Falha → retry
 * com backoff exponencial (run_after). Após MAX_JOB_ATTEMPTS → status='failed'.
 */
async function processOutboundDeliveries(
  hub: ReturnType<typeof createHubServiceClient>,
): Promise<{ picked: number; done: number; failed: number }> {
  const BATCH = 20;
  const { data: rows, error } = await hub
    .from("outbound_deliveries")
    .select("id, url, payload, event, attempts")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .limit(BATCH);

  if (error || !rows || rows.length === 0) {
    return { picked: 0, done: 0, failed: 0 };
  }

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    const id = row.id as string;
    const attempts = (row.attempts as number) + 1;
    const event = (row.event as string) ?? "survey.application";

    try {
      const rawBody = JSON.stringify(row.payload ?? {});
      const res = await fetch(row.url as string, {
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
          .eq("id", id);
        done++;
      } else {
        throw new Error(`http_${res.status}: ${respText.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const finalStatus = attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending";
      const backoffMin = Math.min(60, Math.pow(2, attempts));
      await hub
        .from("outbound_deliveries")
        .update({
          status: finalStatus,
          attempts,
          last_error: msg.slice(0, 500),
          run_after: new Date(Date.now() + backoffMin * 60_000).toISOString(),
        })
        .eq("id", id);
      failed++;
    }
  }

  return { picked: rows.length, done, failed };
}
