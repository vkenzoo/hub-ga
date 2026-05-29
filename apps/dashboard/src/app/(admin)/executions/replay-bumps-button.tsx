"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplayBumpsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    if (
      !confirm(
        "Vai reprocessar webhooks Assiny já processados pra capturar order_bumps que estavam sendo ignorados.\n\nIsso vai criar purchase rows novas pros bumps. Provisioning vai disparar pra produtos de bump configurados. Continuar?",
      )
    )
      return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/replay-assiny-bumps", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Erro: ${body.error ?? "unknown"} ${body.detail ?? ""}`);
      } else {
        alert(
          `${body.candidates ?? 0} webhooks Assiny analisados\n` +
          `${body.replayed ?? 0} reenviadas (tinham bumps)\n` +
          `${body.skipped_no_bumps ?? 0} skipadas (sem bumps)\n` +
          `${body.failed ?? 0} falharam`,
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
      title="Recupera order_bumps Assiny perdidos por bug histórico — só reprocessa webhooks que tinham bumps no payload"
    >
      {pending ? "Recuperando…" : "🎁 Recuperar bumps Assiny"}
    </button>
  );
}
