import type { SupabaseClient } from "@supabase/supabase-js";

type LogLevel = "info" | "warn" | "error";

export async function logEvent(
  hub: SupabaseClient,
  kind: string,
  opts: {
    level?: LogLevel;
    payload?: unknown;
    customerId?: string;
    purchaseId?: string;
  } = {},
): Promise<void> {
  const { error } = await hub.from("events_log").insert({
    kind,
    level: opts.level ?? "info",
    payload: (opts.payload as Record<string, unknown>) ?? null,
    customer_id: opts.customerId ?? null,
    purchase_id: opts.purchaseId ?? null,
  });
  if (error) {
    console.error("[events_log] failed to write:", error);
  }
}
