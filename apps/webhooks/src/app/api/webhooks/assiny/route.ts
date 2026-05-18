import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyAssiny } from "@/lib/hmac";
import { assinyEventSchema, extractGatewayEventId } from "@/lib/parsers/assiny.schema";
import { handleAssinyEvent } from "@/lib/handlers/assiny";
import { logEvent } from "@/lib/logger";
import { runWithExecution } from "@/lib/execution-context";
import { createExecution, finishExecution, type ExecutionStatus } from "@/lib/executions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_HEADERS = [
  "x-assiny-signature",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-webhook-signature",
];

function findSignature(headers: Headers): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const v = headers.get(name);
    if (v) return v;
  }
  return null;
}

function isLikelyAssiny(headers: Headers): boolean {
  const ua = headers.get("user-agent")?.toLowerCase() ?? "";
  return ua.includes("go-resty") || ua.includes("assiny");
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const rawBody = await req.text();
  const hub = createHubServiceClient();
  const executionId = await createExecution(hub, {
    gateway: "assiny",
    headers: req.headers,
    rawBody,
  });

  // Helper pra finalizar a execution e retornar a response.
  // Inclui try/catch ao redor de cada step pra capturar erros em error_message.
  async function finish(status: ExecutionStatus, http: number, body: object, extras?: Partial<Parameters<typeof finishExecution>[2]>) {
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
    const signature = findSignature(req.headers);
    const secret = process.env.ASSINY_WEBHOOK_SECRET;

    if (!secret) {
      return finish("failed", 500, { error: "server_misconfigured" }, {
        errorMessage: "ASSINY_WEBHOOK_SECRET ausente",
      });
    }

    // Auth: HMAC se signature presente, senão User-Agent
    if (signature) {
      if (!verifyAssiny(rawBody, signature, secret)) {
        await logEvent(hub, "webhook.invalid_signature", {
          level: "warn",
          payload: { gateway: "assiny", signature_preview: signature.slice(0, 20) },
        });
        return finish("rejected_auth", 401, { error: "invalid_signature" });
      }
    } else if (!isLikelyAssiny(req.headers)) {
      await logEvent(hub, "webhook.rejected_no_auth", {
        level: "warn",
        payload: {
          gateway: "assiny",
          user_agent: req.headers.get("user-agent") ?? null,
          ip: req.headers.get("x-real-ip") ?? null,
        },
      });
      return finish("rejected_auth", 401, { error: "unauthorized" });
    }

    // Parse JSON
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return finish("invalid_payload", 400, { error: "invalid_json" }, {
        errorMessage: "JSON malformado",
      });
    }

    const parsed = assinyEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      await logEvent(hub, "webhook.invalid_payload", {
        level: "warn",
        payload: { gateway: "assiny", errors: parsed.error.flatten() },
      });
      return finish("invalid_payload", 200, { ok: true, ignored: "invalid_payload" }, {
        rawEventType: typeof (parsedJson as Record<string, unknown> | null)?.event === "string"
          ? String((parsedJson as Record<string, unknown>).event)
          : null,
        errorMessage: JSON.stringify(parsed.error.flatten().fieldErrors).slice(0, 500),
      });
    }

    const event = parsed.data;
    const gatewayEventId = extractGatewayEventId(event);

    try {
      const result = await handleAssinyEvent(hub, event);
      // result discriminado: skipped:false (processou) | skipped:true (várias razões)
      if ("skipped" in result && result.skipped) {
        // mapear razão pra status
        const statusMap: Record<string, ExecutionStatus> = {
          duplicate: "duplicate",
          unknown_product: "unknown_product",
          unknown_event_kind: "unknown_event",
          test_event_no_client: "test_event",
          test_event_no_customer: "test_event",
          missing_subscription_id: "missing_data",
          missing_product_id: "missing_data",
          customer_insert_failed: "failed",
          purchase_insert_failed: "failed",
        };
        const st = statusMap[result.reason] ?? "failed";
        return finish(st, 200, { ok: true, result }, {
          rawEventType: event.event,
          classifiedAs: result.reason,
          gatewayEventId,
        });
      }
      // Sucesso
      return finish("completed", 200, { ok: true, result }, {
        rawEventType: event.event,
        classifiedAs: "processed",
        customerId: "customerId" in result ? result.customerId : null,
        purchaseId: "purchaseId" in result ? result.purchaseId : null,
        gatewayEventId,
      });
    } catch (err) {
      console.error("[assiny] handler error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return finish("failed", 500, { error: "internal_error" }, {
        rawEventType: event.event,
        errorMessage: msg.slice(0, 500),
        gatewayEventId,
      });
    }
  });
}
