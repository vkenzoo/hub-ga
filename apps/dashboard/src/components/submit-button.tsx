"use client";

import { useFormStatus } from "react-dom";

interface Props {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}

export function SubmitButton({
  children,
  pendingLabel = "Salvando...",
  className = "btn btn-sm btn-primary",
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (
        <>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-spin"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
