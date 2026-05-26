"use client";

import { useHideValues } from "./hide-values-context";

type Kind = "money" | "count" | "email" | "phone" | "text";

/**
 * Mascara valores sensíveis quando o "modo banco" tá ativo. Preserva o formato
 * (R$, +55, @gmail.com) mas substitui números e letras por bolinhas.
 */
function mask(raw: string, kind: Kind): string {
  if (!raw) return "";
  switch (kind) {
    case "money":
      // "R$ 1.234,56" → "R$ ••••••"  (preserva o prefixo R$ ou US$)
      return raw.replace(/[\d.,]+/g, "••••••");

    case "count":
      // "42 vendas" → "•• vendas"; "1.234" → "••••"
      return raw.replace(/\d[\d.,]*/g, "••");

    case "email": {
      // "fulano@exemplo.com" → "••••@••••.com"
      const at = raw.indexOf("@");
      if (at < 0) return "•".repeat(Math.max(4, raw.length));
      const domain = raw.slice(at + 1);
      const tld = domain.split(".").pop();
      return `••••@••••.${tld ?? "com"}`;
    }

    case "phone":
      // Mantém pontuação/símbolos, esconde só dígitos
      return raw.replace(/\d/g, "•");

    case "text":
    default:
      // Preserva espaços (pra nomes "João Silva" → "•••• •••••")
      return raw.replace(/\S/g, "•");
  }
}

/**
 * Wrappa qualquer valor que deva sumir quando o usuário clica no olho da sidebar.
 *
 * Uso:
 *   <Hideable kind="money">{fmtMoney(total)}</Hideable>
 *   <Hideable kind="email">{user.email}</Hideable>
 *   <Hideable kind="count">{`${count} vendas`}</Hideable>
 *
 * children pode ser string ou number — internamente coage pra string.
 * Quando não escondido, renderiza o children original (sem wrapper visual).
 */
export function Hideable({
  kind = "money",
  children,
}: {
  kind?: Kind;
  children: React.ReactNode;
}) {
  const { hidden } = useHideValues();
  if (!hidden) return <>{children}</>;
  const raw =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : "";
  return <span className="tabular-nums">{mask(raw, kind)}</span>;
}
