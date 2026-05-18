import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentExecutionId } from "./execution-context";

type LogLevel = "info" | "warn" | "error";

export async function logEvent(
  hub: SupabaseClient,
  kind: string,
  opts: {
    level?: LogLevel;
    payload?: unknown;
    customerId?: string;
    purchaseId?: string;
    executionId?: string;
  } = {},
): Promise<void> {
  const executionId = opts.executionId ?? getCurrentExecutionId();
  const { error } = await hub.from("events_log").insert({
    kind,
    level: opts.level ?? "info",
    payload: (opts.payload as Record<string, unknown>) ?? null,
    customer_id: opts.customerId ?? null,
    purchase_id: opts.purchaseId ?? null,
    webhook_execution_id: executionId ?? null,
  });
  if (error) {
    console.error("[events_log] failed to write:", error);
  }
}
