/**
 * Outbound webhooks — entrega assíncrona via pending_jobs.
 *
 * Fluxo:
 *   1. Evento acontece (purchase.paid, refund, etc.) no handler
 *   2. enqueueOutboundDispatches encontra webhooks ativos subscrito ao evento
 *      e cria 1 pending_job por webhook
 *   3. Cron /api/cron/process-jobs pega os jobs, chama dispatchOutboundWebhook
 *   4. Dispatch faz POST com HMAC-SHA256 do body usando webhook.secret
 *   5. Sucesso → marca last_fired_at + last_status_code
 *      Falha → cron tenta novamente (backoff exponencial)
 *
 * Receiver verifica autenticidade via header X-Hub-Signature-256:
 *   const expected = "sha256=" + hmac(secret, rawBody).digest("hex");
 *   if (req.headers["X-Hub-Signature-256"] === expected) { ... }
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Eventos suportados — deve casar com OUTBOUND_EVENTS em connections/helpers.ts.
 */
export type OutboundEvent =
  | "purchase.paid"
  | "purchase.refunded"
  | "purchase.chargeback"
  | "subscription.renewed"
  | "subscription.past_due"
  | "subscription.cancelled"
  | "customer.created";

interface OutboundBody {
  event: OutboundEvent;
  occurred_at: string;
  data: Record<string, unknown>;
}

/**
 * Cria 1 pending_job por webhook ativo subscrito a esse evento.
 * Não dispara já — cron pega de tempos em tempos.
 */
export async function enqueueOutboundDispatches(
  hub: SupabaseClient,
  event: OutboundEvent,
  data: Record<string, unknown>,
): Promise<{ enqueued: number }> {
  // PostgREST `cs` = "contains" (jsonb/array contém valor). Pra text[] é o operador @>.
  const { data: subs, error } = await hub
    .from("outbound_webhooks")
    .select("id")
    .eq("active", true)
    .contains("events", [event]);

  if (error) {
    console.error("[outbound] enqueue: lookup failed:", error);
    return { enqueued: 0 };
  }

  const subscribers = (subs ?? []) as Array<{ id: string }>;
  if (subscribers.length === 0) return { enqueued: 0 };

  const body: OutboundBody = {
    event,
    occurred_at: new Date().toISOString(),
    data,
  };

  const rows = subscribers.map((w) => ({
    kind: "outbound_dispatch",
    payload: { webhook_id: w.id, event, body },
    status: "queued" as const,
    attempts: 0,
  }));

  const { error: insErr } = await hub.from("pending_jobs").insert(rows);
  if (insErr) {
    console.error("[outbound] enqueue: insert failed:", insErr);
    return { enqueued: 0 };
  }

  return { enqueued: subscribers.length };
}

/**
 * Dispatch real — chamado pelo cron pra cada pending_job.
 * Throws em falha pra que o cron faça retry com backoff.
 */
export async function dispatchOutboundWebhook(
  hub: SupabaseClient,
  payload: { webhook_id: string; event: OutboundEvent; body: OutboundBody },
): Promise<{ status: number }> {
  const { data: webhook, error } = await hub
    .from("outbound_webhooks")
    .select("url, secret, active")
    .eq("id", payload.webhook_id)
    .maybeSingle();

  if (error || !webhook) {
    throw new Error(`outbound_webhook_not_found: ${payload.webhook_id}`);
  }

  // Webhook pode ter sido pausado depois do enqueue → skip silenciosamente
  if (!webhook.active) {
    return { status: 0 };
  }

  if (!webhook.secret) {
    throw new Error(`outbound_missing_secret: ${payload.webhook_id}`);
  }

  const rawBody = JSON.stringify(payload.body);
  const signature = createHmac("sha256", webhook.secret).update(rawBody).digest("hex");

  let res: Response;
  try {
    res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "HubGeracaoA-Webhooks/1.0",
        "X-Hub-Event": payload.event,
        "X-Hub-Signature-256": `sha256=${signature}`,
        "X-Hub-Timestamp": payload.body.occurred_at,
      },
      body: rawBody,
      // 30s — fetch default não tem timeout; aceitamos receivers lentos.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // Network / timeout — atualiza status code -1 pra debug e re-throw pro retry
    await hub
      .from("outbound_webhooks")
      .update({
        last_fired_at: new Date().toISOString(),
        last_status_code: -1,
      })
      .eq("id", payload.webhook_id);
    throw new Error(
      `outbound_network_error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Sempre atualiza last_*, mesmo em erro (pra debug)
  await hub
    .from("outbound_webhooks")
    .update({
      last_fired_at: new Date().toISOString(),
      last_status_code: res.status,
    })
    .eq("id", payload.webhook_id);

  if (res.status >= 200 && res.status < 300) {
    return { status: res.status };
  }

  throw new Error(`outbound_http_${res.status}`);
}

/**
 * Verifica HMAC de webhook recebido — útil pra testes ou se o hub fosse receiver.
 * Não usado em produção, mas mantido como referência da spec.
 */
export function verifyOutboundSignature(
  rawBody: string,
  headerSignature: string | null,
  secret: string,
): boolean {
  if (!headerSignature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const cleaned = headerSignature.replace(/^sha256=/i, "").trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(cleaned);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
