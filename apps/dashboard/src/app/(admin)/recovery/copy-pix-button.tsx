"use client";

import { useState } from "react";

/**
 * Botão que copia o código PIX (copia-e-cola) pro clipboard.
 * Mostra "Copiado!" por 2s após sucesso. Cai pra fallback de textarea quando
 * navigator.clipboard não tá disponível (http, iframe sem permissão, etc).
 */
export function CopyPixButton({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setState("ok");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("err");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`btn-sm ${state === "ok" ? "btn-primary" : "btn-ghost"}`}
      title="Copiar código PIX copia-e-cola"
    >
      {state === "ok" ? "Copiado!" : state === "err" ? "Erro" : "PIX"}
    </button>
  );
}
