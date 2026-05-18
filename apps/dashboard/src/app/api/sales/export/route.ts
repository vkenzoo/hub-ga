import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesma lista do /sales/page.tsx — colunas opcionais que podem entrar no CSV.
const OPTIONAL_KEYS = [
  "product",
  "gateway_funnel_name",
  "gateway_offer_name",
  "utm_source",
  "utm_campaign",
  "affiliate_id",
  "utm_medium",
  "utm_content",
  "utm_term",
] as const;
type OptionalKey = (typeof OPTIONAL_KEYS)[number];

const OPTIONAL_LABEL: Record<OptionalKey, string> = {
  product: "Produto",
  gateway_funnel_name: "Funil",
  gateway_offer_name: "Oferta",
  utm_source: "Origem",
  utm_campaign: "Campanha",
  affiliate_id: "Afiliado",
  utm_medium: "Mídia",
  utm_content: "Anúncio",
  utm_term: "Termo",
};

const PAYMENT_LABELS: Record<string, string> = {
  pix: "PIX",
  PIX: "PIX",
  credit: "Cartão",
  CREDIT: "Cartão",
  credit_card: "Cartão",
  CREDIT_CARD: "Cartão",
  CARD: "Cartão",
  card: "Cartão",
  boleto: "Boleto",
  BOLETO: "Boleto",
  BILLET: "Boleto",
  debit: "Débito",
  DEBIT: "Débito",
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  refunded: "Estornado",
  chargeback: "Chargeback",
  pending: "Pendente",
};

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // RFC 4180: aspas duplas pra escapar aspas, envolve em "..." se tiver vírgula, quebra, ou aspas
  if (/[",\n\r;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  // Garante que só admin logado pode exportar
  await requireAdmin();

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const gateway = url.searchParams.get("gateway") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const colsParam = url.searchParams.getAll("cols");
  const validCols = new Set(OPTIONAL_KEYS);
  const selectedCols: OptionalKey[] = colsParam.filter((c): c is OptionalKey =>
    validCols.has(c as OptionalKey),
  );

  const sb = createSupabaseAdmin();
  let query = sb
    .from("purchases")
    .select(
      `id, amount, status, gateway, gateway_event_id, created_at,
       payment_method, gateway_offer_id, gateway_offer_name, gateway_funnel_name,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term, affiliate_id,
       customers(id, email, name, phone),
       products(id, name)`,
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  if (gateway && gateway !== "all") query = query.eq("gateway", gateway);
  if (status && status !== "all") query = query.eq("status", status);

  const { data } = await query;
  type Row = {
    id: string;
    amount: number;
    status: string;
    gateway: string;
    created_at: string;
    payment_method: string | null;
    gateway_offer_id: string | null;
    gateway_offer_name: string | null;
    gateway_funnel_name: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    affiliate_id: string | null;
    customers: { email: string; name: string | null; phone: string | null } | null;
    products: { name: string } | null;
  };
  let rows = (data ?? []) as unknown as Row[];

  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.customers?.email.toLowerCase().includes(ql) ||
        r.customers?.name?.toLowerCase().includes(ql) ||
        r.products?.name.toLowerCase().includes(ql),
    );
  }

  // Headers fixos + opcionais
  const headers = [
    "Nome",
    "Email",
    "Telefone",
    "Valor",
    "Status",
    "Gateway",
    "Pagamento",
    "Data",
    ...selectedCols.map((c) => OPTIONAL_LABEL[c]),
  ];

  const lines: string[] = [headers.map(csvEscape).join(",")];

  for (const r of rows) {
    const fixed = [
      r.customers?.name ?? "",
      r.customers?.email ?? "",
      r.customers?.phone ?? "",
      // Numérico em pt-BR pra abrir bonito no Excel/Sheets
      Number(r.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      STATUS_LABELS[r.status] ?? r.status,
      String(r.gateway).toUpperCase(),
      r.payment_method ? (PAYMENT_LABELS[r.payment_method] ?? r.payment_method) : "",
      new Date(r.created_at).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    ];

    const optional = selectedCols.map((c) => {
      if (c === "product") return r.products?.name ?? "";
      const v = r[c as keyof Row];
      return v == null ? "" : String(v);
    });

    lines.push([...fixed, ...optional].map(csvEscape).join(","));
  }

  // BOM pro Excel reconhecer UTF-8 sem perder acentos
  const csv = "﻿" + lines.join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const filename = `vendas_${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
