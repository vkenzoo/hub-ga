"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReattributeButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/meta/reattribute", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Erro: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        alert(
          `Reprocessado: ${body.processed} purchases, ${body.matched} bateram, ${body.skipped_already_matched} já estavam OK.`,
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
      title="Reprocessa UTM → campanha pras vendas que ainda não bateram"
    >
      {pending ? "Reprocessando…" : "⟲ Reprocessar atribuições"}
    </button>
  );
}
