import { createSupabaseAdmin } from "./supabase/server";

interface LogAuditParams {
  actor: string;
  action: string;
  target?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Grava 1 linha em audit_log. Usar dentro de server actions / route handlers
 * pra rastrear quem fez o quê. Não throw em erro — auditoria não deve
 * bloquear a ação principal.
 */
export async function logAudit(p: LogAuditParams): Promise<void> {
  const sb = createSupabaseAdmin();
  const { error } = await sb.from("audit_log").insert({
    actor_email: p.actor,
    action: p.action,
    target: p.target ?? null,
    payload: p.payload ?? null,
  });
  if (error) {
    console.error("[audit] failed to log:", p.action, error);
  }
}
