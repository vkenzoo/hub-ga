import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyHubla } from "@/lib/hmac";
import { hublaEventSchema, extractGatewayEventId } from "@/lib/parsers/hubla.schema";
import { handleHublaEvent } from "@/lib/handlers/hubla";
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
    gateway: "hubla",
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
      await finishExecution(hub, executionId, { status, httpStatus: http, startedAt, ...extras });
    }
    return NextResponse.json(body, { status: http });
  }

  return runWithExecution(executionId ?? "no-execution", async () => {
    const secret = process.env.HUBLA_WEBHOOK_TOKEN;
    if (!secret) {
      return finish("failed", 500, { error: "server_misconfigured" }, {
        errorMessage: "HUBLA_WEBHOOK_TOKEN ausente",
      });
    }

    // Auth: token estático no header x-hubla-token
    const token = req.headers.get("x-hubla-token");
    if (!verifyHubla(token, secret)) {
      await logEvent(hub, "webhook.invalid_signature", {
        level: "warn",
        payload: { gateway: "hubla", has_token: !!token },
      });
      return finish("rejected_auth", 401, { error: "invalid_token" });
    }

    // Parse JSON
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return finish("invalid_payload", 400, { error: "invalid_json" }, { errorMessage: "JSON malformado" });
    }

    const parsed = hublaEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      await logEvent(hub, "webhook.invalid_payload", {
        level: "warn",
        payload: { gateway: "hubla", errors: parsed.error.flatten() },
      });
      return finish("invalid_payload", 200, { ok: true, ignored: "invalid_payload" }, {
        rawEventType:
          typeof (parsedJson as Record<string, unknown> | null)?.type === "string"
            ? String((parsedJson as Record<string, unknown>).type)
            : null,
        errorMessage: JSON.stringify(parsed.error.flatten().fieldErrors).slice(0, 500),
      });
    }

    const event = parsed.data;
    const gatewayEventId = extractGatewayEventId(event);

    try {
      const result = await handleHublaEvent(hub, event);
      if ("skipped" in result && result.skipped) {
        const statusMap: Record<string, ExecutionStatus> = {
          duplicate: "duplicate",
          unknown_product: "unknown_product",
          unknown_event_kind: "unknown_event",
          test_event_no_client: "test_event",
          missing_subscription_id: "missing_data",
          missing_product_id: "missing_data",
          missing_data: "missing_data",
          customer_insert_failed: "failed",
          purchase_insert_failed: "failed",
        };
        const st = statusMap[result.reason] ?? "failed";
        return finish(st, 200, { ok: true, result }, {
          rawEventType: event.type,
          classifiedAs: result.reason,
          gatewayEventId,
        });
      }
      return finish("completed", 200, { ok: true, result }, {
        rawEventType: event.type,
        classifiedAs: "processed",
        customerId: "customerId" in result ? result.customerId : null,
        purchaseId: "purchaseId" in result ? result.purchaseId : null,
        gatewayEventId,
      });
    } catch (err) {
      console.error("[hubla] handler error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return finish("failed", 500, { error: "internal_error" }, {
        rawEventType: event.type,
        errorMessage: msg.slice(0, 500),
        gatewayEventId,
      });
    }
  });
}
