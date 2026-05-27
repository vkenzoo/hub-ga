"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplayDuplicatesButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    if (
      !confirm(
        "Vai reprocessar webhook_executions com status='duplicate' dos últimos 30 dias.\n\nIsso pode disparar emails de boas-vindas pras vendas que foram dedup'das erroneamente. Continuar?",
      )
    )
      return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/replay-duplicates", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Erro: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        alert(
          `${body.total ?? 0} duplicates encontrados · ${body.replayed ?? 0} reenviadas com sucesso · ${body.failed ?? 0} falharam`,
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
      className="btn btn-sm btn-ghost disabled:opacity-50"
      title="Reenvia webhook_executions com status='duplicate' (até 500, últimos 30 dias) — útil quando dedup foi falso-positivo por bug"
    >
      {pending ? "Reprocessando…" : "⟲ Reprocessar duplicates"}
    </button>
  );
}
