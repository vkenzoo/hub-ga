import type { SupabaseClient } from "@supabase/supabase-js";

export type ExecutionStatus =
  | "received"
  | "rejected_auth"
  | "invalid_payload"
  | "unknown_event"
  | "unknown_product"
  | "duplicate"
  | "test_event"
  | "missing_data"
  | "completed"
  | "failed";

export type Platform = "assiny" | "hotmart" | "hubla" | "respondi";

interface CreateExecutionParams {
  gateway: Platform;  // mantido como "gateway" pra compatibilidade com schema
  headers: Headers;
  rawBody: string;
}

/**
 * Cria 1 linha em webhook_executions logo ao receber a request.
 * Retorna o id pra o caller propagar via AsyncLocalStorage.
 */
export async function createExecution(
  hub: SupabaseClient,
  p: CreateExecutionParams,
): Promise<string | null> {
  const headersObj: Record<string, string> = {};
  p.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    // Mascara campos sensíveis pra não vazar tokens nos logs
    if (lk.includes("authorization") || lk === "cookie") {
      headersObj[k] = v.slice(0, 12) + "...(masked)";
    } else {
      headersObj[k] = v;
    }
  });

  const { data, error } = await hub
    .from("webhook_executions")
    .insert({
      gateway: p.gateway,
      raw_headers: headersObj,
      raw_body: p.rawBody.slice(0, 60000), // limite defensivo (~60KB)
      body_size_bytes: p.rawBody.length,
      client_ip: p.headers.get("x-real-ip") ?? p.headers.get("x-forwarded-for") ?? null,
      user_agent: p.headers.get("user-agent") ?? null,
      status: "received",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createExecution] failed:", error);
    return null;
  }
  return data.id as string;
}

interface UpdateExecutionParams {
  status: ExecutionStatus;
  httpStatus: number;
  startedAt: number;
  rawEventType?: string | null;
  classifiedAs?: string | null;
  customerId?: string | null;
  purchaseId?: string | null;
  gatewayEventId?: string | null;
  errorMessage?: string | null;
}

export async function finishExecution(
  hub: SupabaseClient,
  executionId: string,
  p: UpdateExecutionParams,
): Promise<void> {
  const duration = Date.now() - p.startedAt;
  const { error } = await hub
    .from("webhook_executions")
    .update({
      status: p.status,
      http_status: p.httpStatus,
      duration_ms: duration,
      raw_event_type: p.rawEventType ?? null,
      classified_as: p.classifiedAs ?? null,
      customer_id: p.customerId ?? null,
      purchase_id: p.purchaseId ?? null,
      gateway_event_id: p.gatewayEventId ?? null,
      error_message: p.errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", executionId);

  if (error) {
    console.error("[finishExecution] failed:", error);
  }
}
