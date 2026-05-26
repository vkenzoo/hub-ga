"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  connectionId: string;
}

export function ConnectionActions({ connectionId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<"sync" | "check" | "delete" | null>(null);

  async function doSync() {
    if (pending) return;
    setPending("sync");
    try {
      const res = await fetch(`/api/meta/sync/${connectionId}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Sync falhou: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        const { ad_accounts_processed, rows_upserted, errors } = body;
        const errMsg = errors && errors.length > 0
          ? `\nErros: ${errors.map((e: { error: string }) => e.error).join(", ")}`
          : "";
        alert(`Sync OK — ${ad_accounts_processed} contas, ${rows_upserted} rows.${errMsg}`);
      }
      router.refresh();
    } catch (e) {
      alert(`Erro de rede: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(null);
    }
  }

  async function doHealthcheck() {
    if (pending) return;
    setPending("check");
    try {
      const res = await fetch(`/api/meta/healthcheck/${connectionId}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        alert(`Verificação falhou: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        alert(`OK — ${body.business_manager_name} (${body.ad_accounts_count} contas)`);
      }
      router.refresh();
    } catch (e) {
      alert(`Erro de rede: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(null);
    }
  }

  async function doDelete() {
    if (pending) return;
    if (!confirm("Remover essa conexão? Cascade apaga ad accounts importadas.")) return;
    setPending("delete");
    try {
      const res = await fetch(`/api/meta/disconnect/${connectionId}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Remoção falhou: ${body.error ?? "unknown"}`);
      }
      router.refresh();
    } catch (e) {
      alert(`Erro de rede: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={doSync}
        disabled={!!pending}
        className="btn btn-sm btn-primary disabled:opacity-50"
        title="Puxa últimos 30 dias de insights"
      >
        {pending === "sync" ? "Sincronizando…" : "⟳ Sincronizar"}
      </button>
      <button
        type="button"
        onClick={doHealthcheck}
        disabled={!!pending}
        className="btn btn-sm btn-ghost disabled:opacity-50"
        title="Re-valida token e re-importa contas"
      >
        {pending === "check" ? "Verificando…" : "↻ Verificar"}
      </button>
      <button
        type="button"
        onClick={doDelete}
        disabled={!!pending}
        className="btn btn-sm btn-ghost text-muted hover:text-danger disabled:opacity-50"
        title="Remover"
      >
        {pending === "delete" ? "…" : "✕"}
      </button>
    </div>
  );
}
