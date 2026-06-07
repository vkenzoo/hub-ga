"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplayFailedButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    if (
      !confirm(
        "Vai reprocessar webhook_executions com status='failed' dos últimos 3 dias.\n\nÚtil pra recuperar vendas que falharam ao gravar (ex: coluna nova durante migration). Continuar?",
      )
    )
      return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/replay-failed", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Erro: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        alert(
          `${body.total ?? 0} falhas encontradas · ${body.replayed ?? 0} reenviadas · ${body.failed ?? 0} falharam de novo`,
        );
      }
      router.refresh();
    } catch (e) {
      alert(`Erro de rede: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="btn btn-sm btn-primary disabled:opacity-50"
      title="Reenvia webhook_executions com status='failed' (até 1000, últimos 3 dias)"
    >
      {pending ? "Reprocessando…" : "⟲ Recuperar falhas"}
    </button>
  );
}
