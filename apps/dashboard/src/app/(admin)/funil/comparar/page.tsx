import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";
import { Hideable } from "@/components/hideable";
import {
  aggregateMonth,
  computeMetrics,
  currentMonthBRT,
  type FunnelMetrics,
} from "@/lib/funnel/aggregate";

type Fmt = "money" | "int" | "pct" | "roas";

function fmt(v: number | null, f: Fmt): string {
  if (v == null || v === 0 || !Number.isFinite(v)) return "–";
  if (f === "money") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (f === "int") return Math.round(v).toLocaleString("pt-BR");
  if (f === "pct") return `${(v * 100).toFixed(2).replace(".", ",")}%`;
  if (f === "roas") return `${v.toFixed(2).replace(".", ",")}x`;
  return String(v);
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

interface Row { label: string; fmt: Fmt; get: (m: FunnelMetrics) => number | null }
interface Section { title: string; tone: string; rows: Row[] }

const SECTIONS: Section[] = [
  {
    title: "Financeiro",
    tone: "bg-info/15 text-info",
    rows: [
      { label: "R$ Valor Investido", fmt: "money", get: (m) => m.investimento },
      { label: "R$ Faturado Front", fmt: "money", get: (m) => m.faturamentoMain },
      { label: "R$ Faturado Funil", fmt: "money", get: (m) => m.faturamentoTotal },
      { label: "R$ Ticket Médio do Funil", fmt: "money", get: (m) => m.ticketMedio },
      { label: "R$ Lucro Líquido do Funil", fmt: "money", get: (m) => m.lucroLiquido },
    ],
  },
  {
    title: "Vendas",
    tone: "bg-brand/15 text-brand",
    rows: [
      { label: "# Vendas Front", fmt: "int", get: (m) => m.porPosicao.main.vendas },
      { label: "# Vendas Totais", fmt: "int", get: (m) => m.vendasTotais },
      { label: "R$ Custo por Venda (CPA)", fmt: "money", get: (m) => m.cpaReal },
    ],
  },
  {
    title: "ROAS",
    tone: "bg-accent/15 text-accent",
    rows: [
      { label: "ROAS Front", fmt: "roas", get: (m) => m.roasMain },
      { label: "ROAS Funil", fmt: "roas", get: (m) => m.roasFunil },
    ],
  },
  {
    title: "Investimento em ADS",
    tone: "bg-accent/15 text-accent",
    rows: [
      { label: "R$ Investimento em ADS", fmt: "money", get: (m) => m.investimento },
      { label: "R$ CPC", fmt: "money", get: (m) => m.cpc },
      { label: "R$ CP View Page", fmt: "money", get: (m) => div(m.investimento, m.viewPage) },
      { label: "R$ CP Initiate Checkout", fmt: "money", get: (m) => m.custoCheckout },
    ],
  },
  {
    title: "Taxas de Conversão",
    tone: "bg-warn/15 text-warn",
    rows: [
      { label: "% Clique → View Page", fmt: "pct", get: (m) => m.viewPagePorClique },
      { label: "% View Page → Checkout", fmt: "pct", get: (m) => m.checkoutPorViewPage },
      { label: "% Checkout → Venda", fmt: "pct", get: (m) => m.vendaPorCheckout },
      { label: "% View Page → Venda", fmt: "pct", get: (m) => m.vendaPorViewPage },
      { label: "% Clique → Venda", fmt: "pct", get: (m) => div(m.porPosicao.main.vendas, m.cliques) },
    ],
  },
  {
    title: "Conversão Upsell / Downsell",
    tone: "bg-brand/15 text-brand",
    rows: [
      { label: "% Conversão UP1", fmt: "pct", get: (m) => m.porPosicao.upsell_01.conversao },
      { label: "% Conversão UP2", fmt: "pct", get: (m) => m.porPosicao.upsell_02.conversao },
      { label: "% Conversão DS1", fmt: "pct", get: (m) => m.porPosicao.downsell_01.conversao },
      { label: "% Conversão DS2", fmt: "pct", get: (m) => m.porPosicao.downsell_02.conversao },
    ],
  },
  {
    title: "Conversão Orders",
    tone: "bg-brand/15 text-brand",
    rows: [
      { label: "% Conversão Order 1", fmt: "pct", get: (m) => m.porPosicao.order_01.conversao },
      { label: "% Conversão Order 2", fmt: "pct", get: (m) => m.porPosicao.order_02.conversao },
      { label: "% Conversão Order 3", fmt: "pct", get: (m) => m.porPosicao.order_03.conversao },
      { label: "% Conversão Order 4", fmt: "pct", get: (m) => m.porPosicao.order_04.conversao },
      { label: "% Conversão Order 5", fmt: "pct", get: (m) => m.porPosicao.order_05.conversao },
    ],
  },
];

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function recentMonths(n: number): string[] {
  const { year, month } = currentMonthBRT();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let y = year;
    let mo = month - i;
    while (mo <= 0) { mo += 12; y -= 1; }
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
  }
  return out;
}

function parseMonths(raw: string | undefined): Array<{ key: string; year: number; month: number }> {
  const keys = raw
    ? raw.split(",").filter((k) => /^\d{4}-\d{2}$/.test(k)).slice(0, 6)
    : recentMonths(3).reverse();
  const seen = new Set<string>();
  const out: Array<{ key: string; year: number; month: number }> = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const [y, m] = k.split("-").map(Number);
    out.push({ key: k, year: y, month: m });
  }
  return out;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "funnel")) redirect("/?error=no_access");
  const sp = await searchParams;
  const selected = parseMonths(sp.months);
  const selectedKeys = new Set(selected.map((s) => s.key));

  const sb = createSupabaseAdmin();
  const aggs = await Promise.all(selected.map((s) => aggregateMonth(sb, s.year, s.month)));
  const cols = selected.map((s, i) => ({
    key: s.key,
    label: `${MONTH_NAMES[s.month - 1]} ${s.year}`,
    metrics: computeMetrics(aggs[i].total),
  }));

  // Chips: últimos 12 meses pra (de)selecionar
  const allMonths = recentMonths(12).map((k) => {
    const [y, m] = k.split("-").map(Number);
    return { key: k, label: `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}` };
  });

  function toggleHref(key: string): string {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const ordered = [...next].sort(); // YYYY-MM ordena cronologicamente
    return ordered.length ? `/funil/comparar?months=${ordered.join(",")}` : "/funil/comparar";
  }

  return (
    <>
      <PageHeader
        title="Comparativo de Meses"
        subtitle="Métricas do funil lado a lado por mês."
        right={<Link href="/funil" className="btn btn-sm btn-ghost">← KPI Funil</Link>}
      />
      <PageBody>
        {/* Seletor de meses */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {allMonths.map((m) => (
            <Link
              key={m.key}
              href={toggleHref(m.key)}
              className={`px-2.5 py-1 rounded transition ${
                selectedKeys.has(m.key) ? "bg-brand text-text" : "text-text2 hover:bg-surface2 hover:text-text"
              }`}
            >
              {m.label}
            </Link>
          ))}
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-line bg-surface2/40">
                <th className="text-left font-medium px-4 py-2.5 min-w-[260px]">Métrica</th>
                {cols.map((c) => (
                  <th key={c.key} className="text-right font-medium px-4 py-2.5 min-w-[140px]">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cols.length === 0 ? (
                <tr><td className="px-4 py-10 text-center text-muted">Selecione ao menos um mês.</td></tr>
              ) : (
                SECTIONS.map((sec) => (
                  <SectionBlock key={sec.title} section={sec} cols={cols} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </PageBody>
    </>
  );
}

function SectionBlock({
  section,
  cols,
}: {
  section: Section;
  cols: Array<{ key: string; label: string; metrics: FunnelMetrics }>;
}) {
  return (
    <>
      <tr>
        <td colSpan={cols.length + 1} className={`px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider ${section.tone}`}>
          {section.title}
        </td>
      </tr>
      {section.rows.map((row) => (
        <tr key={row.label} className="border-b border-line/50 hover:bg-surface2/20">
          <td className="px-4 py-2 text-left text-text2">{row.label}</td>
          {cols.map((c) => (
            <td key={c.key} className="px-4 py-2 text-right tabular-nums">
              <Hideable kind={row.fmt === "money" ? "money" : "count"}>{fmt(row.get(c.metrics), row.fmt)}</Hideable>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
