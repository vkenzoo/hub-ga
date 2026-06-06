"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ReplayResult {
  ok: boolean;
  httpStatus?: number;
  reason?: string;
  error?: string;
}

export function ReplayButton({
  action,
  id,
}: {
  action: (formData: FormData) => Promise<ReplayResult>;
  id: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReplayResult | null>(null);

  function onClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("id", id);
        const r = await action(fd);
        setResult(r);
        if (r.ok) {
          // Sucesso → manda pra lista de executions ver a nova entrada no topo
          setTimeout(() => router.push("/executions"), 1500);
        } else {
          router.refresh();
        }
      } catch (e) {
        setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          className={`text-xs ${result.ok ? "text-accent" : "text-danger"} max-w-xs truncate`}
          title={result.reason ?? result.error ?? ""}
        >
          {result.ok
            ? "✓ Reenviado — abrindo lista…"
            : `Falhou: ${result.reason ?? result.error ?? `HTTP ${result.httpStatus ?? "?"}`}`}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn btn-sm btn-primary disabled:opacity-50"
        title="Reenviar este webhook pra rota de produção. Cria uma execution NOVA — a original fica como está."
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        {pending ? "Reprocessando…" : "Reprocessar"}
      </button>
    </div>
  );
}
