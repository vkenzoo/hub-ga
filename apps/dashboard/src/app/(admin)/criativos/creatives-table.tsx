"use client";

import { useMemo, useState } from "react";

// Linha agregada por ad_name (vinda do server, só somas brutas)
export interface CreativeRow {
  ad_name: string;
  ad_count: number;
  spend_cents: number;
  impressions: number;
  clicks: number;
  lpv: number;
  ic: number;
  video_3s: number;
  video_thruplays: number;
  video_p100: number;
  revenue_cents: number;
  buyers: number;
}

type Fmt = "money" | "int" | "pct" | "ratio";

interface Col {
  key: string;
  label: string;
  fmt: Fmt;
  // valor numérico pra ordenar/formatar; null = "—" e vai pro fim
  value: (r: CreativeRow) => number | null;
  // ordenação default ao clicar pela 1a vez (true = maior primeiro)
  descFirst: boolean;
  // destaque visual (coluna-chave)
  strong?: boolean;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

const COLS: Col[] = [
  { key: "spend", label: "Spend", fmt: "money", value: (r) => r.spend_cents, descFirst: true },
  { key: "impr", label: "Impr.", fmt: "int", value: (r) => r.impressions, descFirst: true },
  { key: "cpm", label: "CPM", fmt: "money", value: (r) => div(r.spend_cents, r.impressions / 1000), descFirst: false },
  { key: "ctr", label: "CTR", fmt: "pct", value: (r) => div(r.clicks, r.impressions), descFirst: true },
  { key: "cpc", label: "CPC", fmt: "money", value: (r) => div(r.spend_cents, r.clicks), descFirst: false },
  { key: "hook", label: "Hook", fmt: "pct", value: (r) => div(r.video_3s, r.impressions), descFirst: true, strong: true },
  { key: "hold", label: "Hold", fmt: "pct", value: (r) => div(r.video_thruplays, r.impressions), descFirst: true },
  { key: "ret", label: "Retenção", fmt: "pct", value: (r) => div(r.video_p100, r.video_3s), descFirst: true },
  { key: "lpv", label: "LPV", fmt: "int", value: (r) => r.lpv, descFirst: true },
  { key: "custo_lpv", label: "Custo/LPV", fmt: "money", value: (r) => div(r.spend_cents, r.lpv), descFirst: false },
  { key: "ic", label: "IC", fmt: "int", value: (r) => r.ic, descFirst: true },
  { key: "custo_ic", label: "Custo/IC", fmt: "money", value: (r) => div(r.spend_cents, r.ic), descFirst: false },
  { key: "vendas", label: "Vendas", fmt: "int", value: (r) => r.buyers, descFirst: true, strong: true },
  { key: "conv", label: "Conv %", fmt: "pct", value: (r) => div(r.buyers, r.lpv), descFirst: true },
  { key: "receita", label: "Receita", fmt: "money", value: (r) => r.revenue_cents, descFirst: true },
  { key: "cpa", label: "CPA", fmt: "money", value: (r) => div(r.spend_cents, r.buyers), descFirst: false, strong: true },
  { key: "tmf", label: "TMF", fmt: "money", value: (r) => div(r.revenue_cents, r.buyers), descFirst: true },
  { key: "roas", label: "ROAS", fmt: "ratio", value: (r) => div(r.revenue_cents, r.spend_cents), descFirst: true, strong: true },
  { key: "ads", label: "Ads", fmt: "int", value: (r) => r.ad_count, descFirst: true },
];

function fmtVal(v: number | null, fmt: Fmt): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (fmt === "money") return (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (fmt === "int") return Math.round(v).toLocaleString("pt-BR");
  if (fmt === "pct") return `${(v * 100).toFixed(2).replace(".", ",")}%`;
  if (fmt === "ratio") return v.toFixed(2).replace(".", ",");
  return String(v);
}

export function CreativesTable({ rows }: { rows: CreativeRow[] }) {
  const [sortKey, setSortKey] = useState<string>("roas");
  const [desc, setDesc] = useState<boolean>(true);

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey);
    const out = [...rows];
    if (sortKey === "ad_name") {
      out.sort((a, b) => a.ad_name.localeCompare(b.ad_name, "pt-BR"));
      if (desc) out.reverse();
      return out;
    }
    if (!col) return out;
    out.sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      // null sempre por último, independente da direção
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return desc ? bv - av : av - bv;
    });
    return out;
  }, [rows, sortKey, desc]);

  function clickSort(key: string, descFirst: boolean) {
    if (sortKey === key) {
      setDesc((d) => !d);
    } else {
      setSortKey(key);
      setDesc(descFirst);
    }
  }

  const arrow = (key: string) => (sortKey === key ? (desc ? " ↓" : " ↑") : "");

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/40 sticky top-0">
          <tr>
            <th
              className="text-left font-medium px-3 py-2.5 sticky left-0 bg-surface2/40 cursor-pointer hover:text-text z-10 min-w-[220px]"
              onClick={() => clickSort("ad_name", false)}
              title="Ordenar por nome"
            >
              Criativo{arrow("ad_name")}
            </th>
            {COLS.map((c) => (
              <th
                key={c.key}
                onClick={() => clickSort(c.key, c.descFirst)}
                className={`text-right font-medium px-3 py-2.5 cursor-pointer hover:text-text select-none ${
                  sortKey === c.key ? "text-brand" : ""
                } ${c.strong ? "bg-brand/5" : ""}`}
                title={`Ordenar por ${c.label}`}
              >
                {c.label}{arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={COLS.length + 1} className="px-4 py-10 text-center text-muted">
                Nenhum criativo no período.
              </td>
            </tr>
          ) : (
            sorted.map((r, i) => (
              <tr key={r.ad_name} className="hover:bg-surface2/30 transition">
                <td className="px-3 py-2.5 sticky left-0 bg-bg/95 backdrop-blur z-10">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-muted tabular-nums w-5 text-right">{i + 1}</span>
                    <span className="truncate max-w-[280px] inline-block align-middle" title={r.ad_name}>
                      {r.ad_name}
                    </span>
                  </div>
                </td>
                {COLS.map((c) => {
                  const v = c.value(r);
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 text-right tabular-nums ${c.strong ? "bg-brand/5 font-medium" : ""} ${
                        v == null ? "text-muted" : ""
                      }`}
                    >
                      {fmtVal(v, c.fmt)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
