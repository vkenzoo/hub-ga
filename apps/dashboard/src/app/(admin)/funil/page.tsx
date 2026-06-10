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
import { FUNNEL_POSITIONS, POSITION_LABEL } from "@/lib/funnel/positions";

type Fmt = "money" | "int" | "pct" | "roas";

function fmt(v: number | null, f: Fmt): string {
  if (v == null || v === 0 || !Number.isFinite(v)) return "–";
  if (f === "money") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (f === "int") return Math.round(v).toLocaleString("pt-BR");
  if (f === "pct") return `${(v * 100).toFixed(2).replace(".", ",")}%`;
  if (f === "roas") return `${v.toFixed(2).replace(".", ",")}x`;
  return String(v);
}

interface Row {
  label: string;
  fmt: Fmt;
  get: (m: FunnelMetrics) => number | null;
  strong?: boolean;
}
interface Section {
  title: string;
  tone: string; // classe de cor do header
  rows: Row[];
}

function buildSections(): Section[] {
  const sections: Section[] = [
    {
      title: "Resumo Geral do Funil",
      tone: "bg-info/15 text-info",
      rows: [
        { label: "R$ Investimento ADS", fmt: "money", get: (m) => m.investimento },
        { label: "R$ Faturamento Total", fmt: "money", get: (m) => m.faturamentoTotal, strong: true },
        { label: "R$ CPA real", fmt: "money", get: (m) => m.cpaReal },
        { label: "% ROAS Produto Principal", fmt: "roas", get: (m) => m.roasMain },
        { label: "% ROAS Funil", fmt: "roas", get: (m) => m.roasFunil, strong: true },
        { label: "R$ Ticket Médio do Funil", fmt: "money", get: (m) => m.ticketMedio },
        { label: "R$ Fat. Produto Principal", fmt: "money", get: (m) => m.faturamentoMain },
        { label: "R$ Imposto Meta (12,5%)", fmt: "money", get: (m) => m.impostoMeta },
        { label: "R$ Lucro Bruto do Funil", fmt: "money", get: (m) => m.lucroBruto },
        { label: "R$ Lucro Líquido do Funil", fmt: "money", get: (m) => m.lucroLiquido, strong: true },
        { label: "# Novos Clientes para Base", fmt: "int", get: (m) => m.novosClientes },
      ],
    },
    {
      title: "Números do Funil",
      tone: "bg-accent/15 text-accent",
      rows: [
        { label: "R$ Investimento em ADS", fmt: "money", get: (m) => m.investimento },
        { label: "# Impressões", fmt: "int", get: (m) => m.impressoes },
        { label: "# Cliques", fmt: "int", get: (m) => m.cliques },
        { label: "R$ Custo por Clique (CPC)", fmt: "money", get: (m) => m.cpc },
        { label: "# View Page", fmt: "int", get: (m) => m.viewPage },
        { label: "# Checkout", fmt: "int", get: (m) => m.checkout },
        { label: "R$ Custo por Checkout", fmt: "money", get: (m) => m.custoCheckout },
        { label: "# Vendas Totais", fmt: "int", get: (m) => m.vendasTotais, strong: true },
      ],
    },
    {
      title: "Taxas de Conversão do Funil",
      tone: "bg-warn/15 text-warn",
      rows: [
        { label: "% Cliques / Impressão (CTR)", fmt: "pct", get: (m) => m.ctr },
        { label: "% View Page / Clique", fmt: "pct", get: (m) => m.viewPagePorClique },
        { label: "% Checkout / View Page", fmt: "pct", get: (m) => m.checkoutPorViewPage },
        { label: "% Venda / View Page", fmt: "pct", get: (m) => m.vendaPorViewPage },
        { label: "% Venda / Checkout", fmt: "pct", get: (m) => m.vendaPorCheckout },
      ],
    },
  ];

  // Uma seção por posição do funil (3 linhas cada)
  for (const p of FUNNEL_POSITIONS) {
    const title = p === "main" ? "Produto Principal" : `Vendas ${POSITION_LABEL[p]}`;
    sections.push({
      title,
      tone: "bg-brand/15 text-brand",
      rows: [
        { label: "# Vendas", fmt: "int", get: (m) => m.porPosicao[p].vendas },
        { label: "% Conversão", fmt: "pct", get: (m) => m.porPosicao[p].conversao },
        { label: "R$ Faturamento", fmt: "money", get: (m) => m.porPosicao[p].faturamento },
      ],
    });
  }
  return sections;
}

function parseMonth(raw: string | undefined): { year: number; month: number } {
  const m = raw && /^(\d{4})-(\d{2})$/.exec(raw);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return { year: y, month: mo };
  }
  return currentMonthBRT();
}

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Últimos 12 meses como {key:'YYYY-MM', label:'Jun 26'}. */
function recentMonths(): Array<{ key: string; label: string }> {
  const { year, month } = currentMonthBRT();
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    let y = year;
    let mo = month - i;
    while (mo <= 0) { mo += 12; y -= 1; }
    out.push({
      key: `${y}-${String(mo).padStart(2, "0")}`,
      label: `${MONTH_NAMES[mo - 1]} ${String(y).slice(2)}`,
    });
  }
  return out;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "funnel")) redirect("/?error=no_access");
  const sp = await searchParams;
  const { year, month } = parseMonth(sp.month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const sb = createSupabaseAdmin();
  const agg = await aggregateMonth(sb, year, month);

  // Métricas por dia + total
  const metricsByDay = new Map<string, FunnelMetrics>();
  for (const day of agg.days) {
    metricsByDay.set(day, computeMetrics(agg.perDay.get(day)!));
  }
  const totalMetrics = computeMetrics(agg.total);

  const sections = buildSections();
  const months = recentMonths();
  const dayNums = agg.days.map((d) => d.slice(8, 10)); // "01".."31"

  return (
    <>
      <PageHeader
        title="KPI Funil"
        subtitle="Desempenho diário do funil de aquisição (Assiny). Métricas × dias do mês."
        right={
          <div className="flex items-center gap-2">
            <Link href="/funil/comparar" className="btn btn-sm btn-ghost">Comparar meses</Link>
            <Link href="/funil/mapeamento" className="btn btn-sm btn-ghost">Mapeamento</Link>
          </div>
        }
      />
      <PageBody>
        {/* Seletor de mês */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {months.map((m) => (
            <Link
              key={m.key}
              href={`/funil?month=${m.key}`}
              className={`px-2.5 py-1 rounded transition ${
                m.key === monthKey ? "bg-brand text-text" : "text-text2 hover:bg-surface2 hover:text-text"
              }`}
            >
              {m.label}
            </Link>
          ))}
        </div>

        {/* Grid métricas × dias */}
        <div className="card overflow-x-auto">
          <table className="text-xs whitespace-nowrap border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface2/40">
                <th className="sticky left-0 z-20 bg-surface2 text-left font-medium px-3 py-2 min-w-[220px]">
                  Métrica
                </th>
                <th className="sticky left-[220px] z-20 bg-surface2 text-right font-medium px-3 py-2 min-w-[120px] border-r border-line">
                  Total do Mês
                </th>
                {dayNums.map((d) => (
                  <th key={d} className="text-right font-medium px-3 py-2 min-w-[80px] text-muted">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => (
                <SectionBlock
                  key={sec.title}
                  section={sec}
                  days={agg.days}
                  metricsByDay={metricsByDay}
                  total={totalMetrics}
                  dayCount={dayNums.length}
                />
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-2xs text-muted">
          Faturamento usa o líquido quando disponível (Hotmart); Assiny conta o valor bruto.
          Ofertas sem posição no <Link href="/funil/mapeamento" className="text-brand hover:underline">Mapeamento</Link> ficam fora do funil.
          Métricas de mídia: campanhas classificadas como Aquisição.
        </p>
      </PageBody>
    </>
  );
}

function SectionBlock({
  section,
  days,
  metricsByDay,
  total,
  dayCount,
}: {
  section: Section;
  days: string[];
  metricsByDay: Map<string, FunnelMetrics>;
  total: FunnelMetrics;
  dayCount: number;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={dayCount + 2}
          className={`px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider ${section.tone}`}
        >
          {section.title}
        </td>
      </tr>
      {section.rows.map((row) => (
        <tr key={row.label} className="border-b border-line/50 hover:bg-surface2/20">
          <td className={`sticky left-0 z-10 bg-bg px-3 py-1.5 text-left ${row.strong ? "font-medium" : "text-text2"}`}>
            {row.label}
          </td>
          <td className={`sticky left-[220px] z-10 bg-bg px-3 py-1.5 text-right tabular-nums border-r border-line ${row.strong ? "font-medium text-text" : ""}`}>
            <Hideable kind={row.fmt === "money" ? "money" : "count"}>{fmt(row.get(total), row.fmt)}</Hideable>
          </td>
          {days.map((d) => {
            const m = metricsByDay.get(d)!;
            const v = row.get(m);
            return (
              <td key={d} className={`px-3 py-1.5 text-right tabular-nums ${v == null || v === 0 ? "text-muted/40" : "text-text2"}`}>
                <Hideable kind={row.fmt === "money" ? "money" : "count"}>{fmt(v, row.fmt)}</Hideable>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
