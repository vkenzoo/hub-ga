"use client";

import { createContext, useCallback, useContext, useState } from "react";

const HideCtx = createContext<{ hidden: boolean; toggle: () => void } | null>(null);

const COOKIE_NAME = "hide_values";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 ano

export function HideValuesProvider({
  initialHidden,
  children,
}: {
  initialHidden: boolean;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(initialHidden);

  const toggle = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      // Persiste em cookie pra próxima renderização SSR já vir com o estado correto.
      // SameSite=Lax pra não vazar entre sites; max-age = 1 ano.
      document.cookie = `${COOKIE_NAME}=${next ? "1" : "0"}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
      return next;
    });
  }, []);

  return <HideCtx.Provider value={{ hidden, toggle }}>{children}</HideCtx.Provider>;
}

export function useHideValues(): { hidden: boolean; toggle: () => void } {
  const ctx = useContext(HideCtx);
  if (!ctx) {
    // Fora do provider — assume sempre visível pra não quebrar
    return { hidden: false, toggle: () => {} };
  }
  return ctx;
}

export const HIDE_VALUES_COOKIE_NAME = COOKIE_NAME;
