"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Hideable } from "@/components/hideable";
import {
  COLUMNS,
  DEFAULT_COLS,
  fmtCell,
  type CampaignAgg,
  type ColKey,
  type Level,
} from "./columns";

function classificationChip(c: CampaignAgg["classification"]) {
  if (c === "acquisition") return { dot: "bg-brand", label: "Aquisição" };
  if (c === "monetization") return { dot: "bg-info", label: "Monetização" };
  if (c === "other") return { dot: "bg-muted", label: "Outros" };
  return { dot: "bg-text2", label: "Sem regra" };
}

interface Props {
  rows: CampaignAgg[];
  /** Filhos por campaign_id — usado pra expandir no nível Campanha */
  childrenByCampaign: Record<string, CampaignAgg[]>;
  /** Quais colunas mostrar (cols na URL → ColKey[]) */
  cols: ColKey[];
  /** Nível atual da agregação */
  level: Level;
  /** Querystring atual pra preservar em links da ColumnsToggle */
  preservedQuery: string;
}

export function InsightsTable({ rows, childrenByCampaign, cols, level, preservedQuery }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const colDefs = useMemo(() => {
    const map = new Map(COLUMNS.map((c) => [c.key, c]));
    return cols.map((k) => map.get(k)).filter((c) => c != null);
  }, [cols]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canExpand = level === "campaign";

  return (
    <div className="card overflow-hidden">
      {/* Header com cols toggle */}
      <div className="px-3 py-2 border-b border-line flex items-center justify-end">
        <ColumnsToggle current={cols} preservedQuery={preservedQuery} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-text2 border-b border-line">
            <tr>
              {canExpand && <th className="px-2 py-2.5 w-8" />}
              <th className="px-3 py-2.5 font-normal">
                {level === "campaign" ? "Campanha" : level === "adset" ? "Adset" : "Ad"}
              </th>
              {level === "campaign" && (
                <th className="px-3 py-2.5 font-normal">Classif.</th>
              )}
              {colDefs.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 font-normal ${
                    col.align === "right" ? "text-right" : ""
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={colDefs.length + (canExpand ? 2 : 1) + (level === "campaign" ? 1 : 0)}
                  className="px-3 py-8 text-center text-muted"
                >
                  Nenhuma {level === "campaign" ? "campanha" : level} com spend no período.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = expanded.has(r.campaign_id);
              const children = childrenByCampaign[r.campaign_id] ?? [];
              return (
                <FragmentRow key={`${level}-${r.campaign_id}-${r.adset_id ?? ""}-${r.ad_id ?? ""}`}>
                  <RowMain
                    row={r}
                    cols={cols}
                    level={level}
                    expandable={canExpand && children.length > 0}
                    expanded={isOpen}
                    onToggle={() => toggleExpand(r.campaign_id)}
                  />
                  {isOpen && canExpand && children.map((child) => (
                    <RowChild
                      key={`child-${child.ad_id ?? child.adset_id}`}
                      row={child}
                      cols={cols}
                      level={level}
                    />
                  ))}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-line text-2xs text-muted">
        {rows.length} {level === "campaign" ? (rows.length === 1 ? "campanha" : "campanhas") : level === "adset" ? "adsets" : "ads"}
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function RowMain({
  row,
  cols,
  level,
  expandable,
  expanded,
  onToggle,
}: {
  row: CampaignAgg;
  cols: ColKey[];
  level: Level;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chip = level === "campaign" ? classificationChip(row.classification) : null;
  const name =
    level === "campaign"
      ? row.campaign_name
      : level === "adset"
        ? row.adset_name ?? "(sem nome)"
        : row.ad_name ?? "(sem nome)";
  const subline =
    level === "campaign"
      ? row.ad_account_name ?? row.campaign_id
      : level === "adset"
        ? row.campaign_name
        : row.adset_name ?? row.campaign_name;

  return (
    <tr className="border-b border-line/40 hover:bg-surface2/30">
      {level === "campaign" && (
        <td className="px-2 py-2.5 w-8 text-center">
          {expandable ? (
            <button
              type="button"
              onClick={onToggle}
              className="text-muted hover:text-text transition"
              aria-label={expanded ? "Recolher" : "Expandir"}
            >
              {expanded ? "▼" : "▶"}
            </button>
          ) : null}
        </td>
      )}
      <td className="px-3 py-2.5">
        <div className="text-text leading-snug">{name}</div>
        <div className="text-2xs text-muted mt-0.5">{subline}</div>
      </td>
      {level === "campaign" && chip && (
        <td className="px-3 py-2.5">
          <span className="chip">
            <span className={`dot ${chip.dot}`} />
            {chip.label}
          </span>
        </td>
      )}
      {COLUMNS.filter((c) => cols.includes(c.key)).map((col) => (
        <CellValue key={col.key} col={col} row={row} bold={col.key === "spend"} />
      ))}
    </tr>
  );
}

function RowChild({
  row,
  cols,
  level: _level,
}: {
  row: CampaignAgg;
  cols: ColKey[];
  level: Level;
}) {
  const childName = row.ad_name ?? row.adset_name ?? "(sem nome)";
  return (
    <tr className="border-b border-line/30 bg-surface2/20">
      <td className="px-2 py-2 w-8" />
      <td className="px-3 py-2 pl-8">
        <div className="text-text2 text-xs leading-snug">↳ {childName}</div>
        {row.adset_name && row.ad_name && (
          <div className="text-2xs text-muted mt-0.5">{row.adset_name}</div>
        )}
      </td>
      <td className="px-3 py-2" />
      {COLUMNS.filter((c) => cols.includes(c.key)).map((col) => (
        <CellValue key={col.key} col={col} row={row} muted />
      ))}
    </tr>
  );
}

function CellValue({
  col,
  row,
  bold,
  muted,
}: {
  col: (typeof COLUMNS)[number];
  row: CampaignAgg;
  bold?: boolean;
  muted?: boolean;
}) {
  const value = col.compute(row);
  const text = fmtCell(value, col.format);
  const isMoney = col.format === "money";
  const kind = isMoney ? "money" : col.format === "count" ? "count" : "count";

  let cls = "";
  if (muted) cls = "text-muted text-xs";
  else if (bold) cls = "font-medium";
  if (col.highlight === "accent" && value && value > 0 && !muted) cls += " text-accent font-medium";

  // ROAS muda cor pela performance
  if (col.format === "roas" && value != null) {
    cls += value >= 1 ? " text-accent" : " text-warn";
  }

  return (
    <td className={`px-3 py-2.5 ${col.align === "right" ? "text-right" : ""} ${cls}`}>
      {value == null ? (
        <span className="text-muted">—</span>
      ) : (
        <Hideable kind={kind}>{text}</Hideable>
      )}
    </td>
  );
}

function ColumnsToggle({
  current,
  preservedQuery,
}: {
  current: ColKey[];
  preservedQuery: string;
}) {
  const currentSet = new Set(current);
  const buildHref = (toggleKey: ColKey) => {
    const next = currentSet.has(toggleKey)
      ? current.filter((k) => k !== toggleKey)
      : [...current, toggleKey];
    const params = new URLSearchParams(preservedQuery);
    params.delete("cols");
    if (next.length > 0 && next.length !== DEFAULT_COLS.length) {
      params.set("cols", next.join(","));
    } else if (next.length === 0) {
      // Tudo desligado — força cols vazia explícita pra distinguir de default
      params.set("cols", "_none");
    } else {
      // Default ativado — limpa o param
    }
    const s = params.toString();
    return `/meta-ads${s ? "?" + s : ""}`;
  };

  return (
    <details className="relative">
      <summary className="btn btn-sm btn-ghost list-none cursor-pointer">
        ⚙ Colunas
      </summary>
      <div className="absolute right-0 mt-2 z-10 card p-3 w-56 max-h-96 overflow-y-auto">
        <div className="text-2xs text-muted uppercase tracking-wider mb-2 pb-2 border-b border-line">
          Mostrar colunas
        </div>
        {COLUMNS.map((col) => {
          const active = currentSet.has(col.key);
          return (
            <Link
              key={col.key}
              href={buildHref(col.key)}
              className="flex items-center gap-2 py-1.5 px-1 hover:bg-surface2 rounded text-sm"
            >
              <span
                className={`inline-block w-3.5 h-3.5 rounded border ${
                  active ? "bg-brand border-brand" : "border-line"
                } grid place-items-center text-2xs text-text`}
              >
                {active ? "✓" : ""}
              </span>
              <span className="text-text2">{col.label}</span>
            </Link>
          );
        })}
      </div>
    </details>
  );
}
