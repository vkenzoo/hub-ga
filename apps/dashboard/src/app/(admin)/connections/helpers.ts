// Helpers compartilhados entre as subpáginas de /connections.

export interface Connection {
  id: string;
  kind: string;
  label: string;
  status: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface OutboundRow {
  id: string;
  label: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  last_fired_at: string | null;
  last_status_code: number | null;
  created_at: string;
}

export const ERROR_LABELS: Record<string, string> = {
  missing_fields: "Preencha todos os campos obrigatórios.",
  missing_label: "Dê um nome pra essa conexão.",
  invalid_url: "URL precisa começar com https://",
  no_events: "Selecione ao menos um evento pra disparar.",
  insert_failed: "Falha ao salvar. Tente novamente.",
  no_access: "Você não tem permissão pra essa seção.",
};

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function statusChip(status: string): { dot: string; label: string } {
  if (status === "active") return { dot: "bg-accent", label: "Ativo" };
  if (status === "error") return { dot: "bg-danger", label: "Erro" };
  if (status === "disabled") return { dot: "bg-text2", label: "Desativado" };
  return { dot: "bg-warn", label: "Pendente" };
}

export const OUTBOUND_EVENTS = [
  { value: "purchase.paid", label: "Venda paga" },
  { value: "purchase.refunded", label: "Venda estornada" },
  { value: "purchase.chargeback", label: "Chargeback" },
  { value: "subscription.renewed", label: "Assinatura renovada" },
  { value: "subscription.past_due", label: "Assinatura atrasada" },
  { value: "subscription.cancelled", label: "Assinatura cancelada" },
  { value: "customer.created", label: "Cliente novo" },
  { value: "survey.application", label: "Aplicação (form de call)" },
];
