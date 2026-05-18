import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyHotmart } from "@/lib/hmac";
import { hotmartEventSchema } from "@/lib/parsers/hotmart.schema";
import { handleHotmartEvent } from "@/lib/handlers/hotmart";
import { logEvent } from "@/lib/logger";
import { runWithExecution } from "@/lib/execution-context";
import { createExecution, finishExecution, type ExecutionStatus } from "@/lib/executions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const startedAt = Date.now();
  const rawBody = await req.text();
  const hub = createHubServiceClient();
  const executionId = await createExecution(hub, {
    gateway: "hotmart",
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
    const token =
      req.headers.get("x-hotmart-hottok") ??
      req.headers.get("hottok") ??
      req.headers.get("x-hottok");
    const secret = process.env.HOTMART_WEBHOOK_SECRET;

    if (!secret) {
      return finish("failed", 500, { error: "server_misconfigured" }, {
        errorMessage: "HOTMART_WEBHOOK_SECRET ausente",
      });
    }

    if (!verifyHotmart(token, secret)) {
      await logEvent(hub, "webhook.invalid_signature", {
        level: "warn",
        payload: { gateway: "hotmart", token_present: !!token },
      });
      return finish("rejected_auth", 401, { error: "invalid_token" });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return finish("invalid_payload", 400, { error: "invalid_json" }, {
        errorMessage: "JSON malformado",
      });
    }

    const parsed = hotmartEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      await logEvent(hub, "webhook.invalid_payload", {
        level: "warn",
        payload: { gateway: "hotmart", errors: parsed.error.flatten() },
      });
      return finish("invalid_payload", 200, { ok: true, ignored: "invalid_payload" }, {
        rawEventType: typeof (parsedJson as Record<string, unknown> | null)?.event === "string"
          ? String((parsedJson as Record<string, unknown>).event)
          : null,
        errorMessage: JSON.stringify(parsed.error.flatten().fieldErrors).slice(0, 500),
      });
    }

    const event = parsed.data;

    try {
      const result = await handleHotmartEvent(hub, event);
      if ("skipped" in result && result.skipped) {
        const statusMap: Record<string, ExecutionStatus> = {
          duplicate: "duplicate",
          unknown_product: "unknown_product",
          unknown_event_kind: "unknown_event",
          missing_subscription_id: "missing_data",
          missing_purchase: "missing_data",
          customer_insert_failed: "failed",
          purchase_insert_failed: "failed",
        };
        const st = statusMap[result.reason] ?? "failed";
        return finish(st, 200, { ok: true, result }, {
          rawEventType: event.event,
          classifiedAs: result.reason,
          gatewayEventId: event.id,
        });
      }
      return finish("completed", 200, { ok: true, result }, {
        rawEventType: event.event,
        classifiedAs: "processed",
        customerId: "customerId" in result ? result.customerId : null,
        purchaseId: "purchaseId" in result ? result.purchaseId : null,
        gatewayEventId: event.id,
      });
    } catch (err) {
      console.error("[hotmart] handler error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return finish("failed", 500, { error: "internal_error" }, {
        rawEventType: event.event,
        errorMessage: msg.slice(0, 500),
        gatewayEventId: event.id,
      });
    }
  });
}
