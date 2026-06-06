"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ReplayButton({ action, id }: { action: (formData: FormData) => Promise<void>; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function onClick() {
    if (pending) return;
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("id", id);
        await action(fd);
        setDone(true);
        setTimeout(() => setDone(false), 3000);
        router.refresh();
      } catch (e) {
        alert(`Erro ao reprocessar: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn btn-sm btn-primary disabled:opacity-50"
      title="Reenviar este webhook pra rota de produção. Útil quando o motivo do skip já foi resolvido (ex: produto cadastrado depois)."
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
      {pending ? "Reprocessando…" : done ? "✓ Reenviado" : "Reprocessar"}
    </button>
  );
}
