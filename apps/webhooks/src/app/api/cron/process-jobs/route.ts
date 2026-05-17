import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { MAX_JOB_ATTEMPTS } from "@hub/shared";
import { createSystemUser } from "@/lib/provisioning/create-system-user";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel chama esse endpoint na frequência definida em vercel.json.
// Protegido por CRON_SECRET no header Authorization: Bearer <secret>.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
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

  return NextResponse.json({ ok: true, picked: jobs?.length ?? 0, done, failed });
}
