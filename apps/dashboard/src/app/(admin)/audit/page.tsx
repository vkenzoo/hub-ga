import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface AuditRow {
  id: string;
  actor_email: string;
  action: string;
  target: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_STYLES: Record<string, { dot: string; label: string }> = {
  "team.invite":      { dot: "bg-accent",  label: "Convidou membro" },
  "team.update":      { dot: "bg-info",    label: "Atualizou acesso" },
  "team.remove":      { dot: "bg-danger",  label: "Removeu membro" },
  "execution.replay": { dot: "bg-warn",    label: "Reprocessou execution" },
  "profile.update":   { dot: "bg-text2",   label: "Editou perfil" },
  "product.create":   { dot: "bg-accent",  label: "Criou produto" },
  "product.update":   { dot: "bg-info",    label: "Atualizou produto" },
  "product.delete":   { dot: "bg-danger",  label: "Excluiu produto" },
};

function actionInfo(action: string) {
  return ACTION_STYLES[action] ?? { dot: "bg-text2", label: action };
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function listAudit(filters: {
  actor?: string;
  action?: string;
  target?: string;
}): Promise<AuditRow[]> {
  const sb = createSupabaseAdmin();
  let q = sb
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (filters.actor) q = q.eq("actor_email", filters.actor);
  if (filters.action && filters.action !== "all") q = q.eq("action", filters.action);
  if (filters.target) q = q.ilike("target", `%${filters.target}%`);

  const { data } = await q;
  return (data ?? []) as AuditRow[];
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; target?: string }>;
}) {
  const sp = await searchParams;
  await requireSuperAdmin();

  const rows = await listAudit(sp);

  return (
    <>
      <PageHeader
        title="Auditoria"
        subtitle="Trilha completa de quem fez o quê e quando. Não-editável."
        right={
          <span className="chip">
            <span className="dot bg-brand" /> Restrito a Admin
          </span>
        }
      />

      <PageBody>
        {/* Filtros */}
        <form className="card p-3 grid grid-cols-1 md:grid-cols-[1fr_220px_220px_auto_auto] gap-2 items-center">
          <input
            type="search"
            name="target"
            defaultValue={sp.target ?? ""}
            placeholder="Buscar alvo (email, id, etc.)..."
            className="input"
          />
          <input
            type="search"
            name="actor"
            defaultValue={sp.actor ?? ""}
            placeholder="Email do executor..."
            className="input"
          />
          <select name="action" defaultValue={sp.action ?? "all"} className="input">
            <option value="all">Todas as ações</option>
            <option value="team.invite">Convite de membro</option>
            <option value="team.update">Atualização de acesso</option>
            <option value="team.remove">Remoção de membro</option>
            <option value="execution.replay">Reprocessamento</option>
            <option value="profile.update">Edição de perfil</option>
          </select>
          <button className="btn btn-sm">Filtrar</button>
          <Link href="/audit" className="btn btn-sm btn-ghost">Limpar</Link>
        </form>

        {/* Lista */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {rows.length} {rows.length === 1 ? "evento" : "eventos"}
            </h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Últimos 500</span>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              Nenhuma ação registrada com esses filtros.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const info = actionInfo(r.action);
                const hasPayload = r.payload && Object.keys(r.payload).length > 0;
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="chip">
                            <span className={`dot ${info.dot}`} /> {info.label}
                          </span>
                          <code className="font-mono text-2xs text-muted">{r.action}</code>
                        </div>
                        <div className="text-sm">
                          <span className="text-text2">{r.actor_email}</span>
                          {r.target && (
                            <>
                              <span className="text-muted mx-1.5">→</span>
                              <span className="font-mono text-xs text-text">{r.target}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-2xs text-muted tabular-nums shrink-0 whitespace-nowrap">
                        {fmtDateTime(r.created_at)}
                      </span>
                    </div>
                    {hasPayload && (
                      <details className="mt-2">
                        <summary className="text-2xs text-muted hover:text-text2 cursor-pointer select-none">
                          payload
                        </summary>
                        <pre className="mt-1.5 bg-surface2/30 border border-line rounded p-2 text-xs font-mono overflow-x-auto whitespace-pre">
                          {JSON.stringify(r.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PageBody>
    </>
  );
}
