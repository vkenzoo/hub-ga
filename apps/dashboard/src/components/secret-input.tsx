"use client";

import { useState } from "react";

interface Props {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  showCopy?: boolean;
}

export function SecretInput({
  name,
  defaultValue,
  placeholder,
  required,
  readOnly,
  showCopy,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!defaultValue) return;
    try {
      await navigator.clipboard.writeText(defaultValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignora se clipboard não disponível
    }
  }

  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        className={`input font-mono text-xs pr-20 ${readOnly ? "opacity-80" : ""}`}
        autoComplete="off"
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {showCopy && defaultValue && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 text-muted hover:text-text rounded transition"
            title={copied ? "Copiado!" : "Copiar"}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="p-1.5 text-muted hover:text-text rounded transition"
          title={revealed ? "Esconder" : "Mostrar"}
          aria-label={revealed ? "Esconder valor" : "Mostrar valor"}
        >
          {revealed ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}
