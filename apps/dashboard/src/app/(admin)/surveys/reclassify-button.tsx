"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReclassifyButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/surveys/reclassify", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Erro: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        const relinked = (body.relinked_by_email ?? 0) + (body.relinked_by_phone ?? 0);
        alert(
          `Re-linkados: ${relinked} customer matches (${body.relinked_by_email ?? 0} por email, ${body.relinked_by_phone ?? 0} por phone)\n` +
          `Reclassificados: ${body.processed ?? 0} processadas, ${body.classified ?? 0} casaram com regra.`,
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
      title="Re-aplica as regras de qualificação em respostas que ainda não foram classificadas"
    >
      {pending ? "Reclassificando…" : "⟲ Reclassificar"}
    </button>
  );
}
