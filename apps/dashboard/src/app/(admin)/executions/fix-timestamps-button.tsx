"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FixTimestampsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    if (
      !confirm(
        "Vai corrigir purchases.created_at usando o timestamp REAL do payload original (raw_body) das últimas 48h.\n\nÚtil quando replay inseriu com created_at = NOW(). Continuar?",
      )
    )
      return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/fix-purchase-timestamps", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Erro: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        alert(
          `${body.checked ?? 0} verificadas · ${body.fixed ?? 0} corrigidas · ${body.skippedAlreadyOk ?? 0} ok · ${body.skippedNoExec ?? 0} sem exec match · ${body.skippedNoTs ?? 0} sem timestamp`,
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
      title="Corrige purchases.created_at das últimas 48h usando timestamp do raw_body"
    >
      {pending ? "Corrigindo…" : "🕐 Corrigir horários"}
    </button>
  );
}
