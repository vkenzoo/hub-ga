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
} from "./columns";

// ── Tipos ────────────────────────────────────────────────────
export interface RawInsight {
  ad_account_id: string;
  date_start: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  initiated_checkouts: number;
  classification: "acquisition" | "monetization" | "other" | null;
}

interface RevenueAgg {
  revenue_cents: number;
  sales_count: number;
}

interface Props {
  insights: RawInsight[];
  accountNameById: Record<string, string | null>;
  revByCampaign: Record<string, RevenueAgg>;
  revByAdset: Record<string, RevenueAgg>;
  revByAd: Record<string, RevenueAgg>;
  cols: ColKey[];
  preservedQuery: string;
}

type Level = "campaign" | "adset" | "ad";

// ── Helpers ──────────────────────────────────────────────────
function classificationChip(c: CampaignAgg["classification"]) {
  if (c === "acquisition") return { dot: "bg-brand", label: "Aquisição" };
  if (c === "monetization") return { dot: "bg-info", label: "Monetização" };
  if (c === "other") return { dot: "bg-muted", label: "Outros" };
  return { dot: "bg-text2", label: "Sem regra" };
}

function emptyAgg(id: string, name: string): CampaignAgg {
  return {
    campaign_id: id,
    campaign_name: name,
    adset_id: null,
    adset_name: null,
    ad_id: null,
    ad_name: null,
    ad_account_name: null,
    spend_cents: 0,
    impressions: 0,
    clicks: 0,
    landing_page_views: 0,
    initiated_checkouts: 0,
    ads_count: 0,
    days: 0,
    classification: null,
    revenue_cents: 0,
    sales_count: 0,
  };
}

function aggregateInsights(
  rows: RawInsight[],
  level: Level,
  rev: Record<string, RevenueAgg>,
  accountNameById: Record<string, string | null>,
): CampaignAgg[] {
  const map = new Map<string, CampaignAgg>();
  const adsByKey = new Map<string, Set<string>>();
  const daysByKey = new Map<string, Set<string>>();

  for (const r of rows) {
    let key: string;
    let revId: string | null;
    if (level === "campaign") {
      key = r.campaign_id;
      revId = r.campaign_id;
    } else if (level === "adset") {
      if (!r.adset_id) continue;
      key = r.adset_id;
      revId = r.adset_id;
    } else {
      key = r.ad_id;
      revId = r.ad_id;
    }

    if (!map.has(key)) {
      const a = emptyAgg(r.campaign_id, r.campaign_name ?? "(sem nome)");
      a.ad_account_name = accountNameById[r.ad_account_id] ?? null;
      a.classification = r.classification;
      if (level !== "campaign") {
        a.adset_id = r.adset_id;
        a.adset_name = r.adset_name;
      }
      if (level === "ad") {
        a.ad_id = r.ad_id;
        a.ad_name = r.ad_name;
      }
      const rv = revId ? rev[revId] : undefined;
      a.revenue_cents = rv?.revenue_cents ?? 0;
      a.sales_count = rv?.sales_count ?? 0;
      map.set(key, a);
    }
    const m = map.get(key)!;
    m.spend_cents += r.spend_cents;
    m.impressions += r.impressions;
    m.clicks += r.clicks;
    m.landing_page_views += r.landing_page_views;
    m.initiated_checkouts += r.initiated_checkouts;

    if (!daysByKey.has(key)) daysByKey.set(key, new Set());
    daysByKey.get(key)!.add(r.date_start);

    if (level === "campaign") {
      if (!adsByKey.has(key)) adsByKey.set(key, new Set());
      adsByKey.get(key)!.add(r.ad_id);
    } else if (level === "adset") {
      if (!adsByKey.has(key)) adsByKey.set(key, new Set());
      adsByKey.get(key)!.add(r.ad_id);
    }
  }
  for (const [k, days] of daysByKey) {
    const a = map.get(k);
    if (a) a.days = days.size;
  }
  for (const [k, ads] of adsByKey) {
    const a = map.get(k);
    if (a) a.ads_count = ads.size;
  }
  return Array.from(map.values()).sort((a, b) => b.spend_cents - a.spend_cents);
}

// ── Componente principal ────────────────────────────────────
export function DrillDown({
  insights,
  accountNameById,
  revByCampaign,
  revByAdset,
  revByAd,
  cols,
  preservedQuery,
}: Props) {
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<string>>(new Set());
  const [selectedAdsets, setSelectedAdsets] = useState<Set<string>>(new Set());

  // Campanhas — sempre todas, ignora seleção (seleção controla próximo nível)
  const campaignAggs = useMemo(
    () => aggregateInsights(insights, "campaign", revByCampaign, accountNameById),
    [insights, revByCampaign, accountNameById],
  );

  // Adsets — filtra pelas campanhas selecionadas (ou nada se vazio)
  const adsetAggs = useMemo(() => {
    if (selectedCampaigns.size === 0) return [];
    const filtered = insights.filter((r) => selectedCampaigns.has(r.campaign_id));
    return aggregateInsights(filtered, "adset", revByAdset, accountNameById);
  }, [insights, selectedCampaigns, revByAdset, accountNameById]);

  // Ads — filtra pelos adsets selecionados (ou nada se vazio)
  const adAggs = useMemo(() => {
    if (selectedAdsets.size === 0) return [];
    const filtered = insights.filter(
      (r) => r.adset_id && selectedAdsets.has(r.adset_id),
    );
    return aggregateInsights(filtered, "ad", revByAd, accountNameById);
  }, [insights, selectedAdsets, revByAd, accountNameById]);

  function toggleCampaign(id: string) {
    setSelectedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Limpa adsets selecionados quando muda seleção de campanhas (campanha
    // removida da seleção pode invalidar adsets selecionados dela)
    setSelectedAdsets(new Set());
  }

  function toggleAdset(id: string) {
    setSelectedAdsets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Header com cols toggle */}
      <div className="flex items-center justify-end">
        <ColumnsToggle current={cols} preservedQuery={preservedQuery} />
      </div>

      {/* Section 1: Campanhas */}
      <Section
        title="Campanhas"
        count={campaignAggs.length}
        hint={selectedCampaigns.size > 0 ? `${selectedCampaigns.size} selecionada${selectedCampaigns.size === 1 ? "" : "s"}` : "Marque pra ver os adsets"}
      >
        <Table
          rows={campaignAggs}
          cols={cols}
          level="campaign"
          selectedIds={selectedCampaigns}
          onToggle={toggleCampaign}
        />
      </Section>

      {/* Section 2: Adsets */}
      {selectedCampaigns.size > 0 && (
        <Section
          title="Adsets"
          count={adsetAggs.length}
          hint={selectedAdsets.size > 0 ? `${selectedAdsets.size} selecionado${selectedAdsets.size === 1 ? "" : "s"}` : "Marque pra ver os ads"}
        >
          <Table
            rows={adsetAggs}
            cols={cols}
            level="adset"
            selectedIds={selectedAdsets}
            onToggle={toggleAdset}
          />
        </Section>
      )}

      {/* Section 3: Ads */}
      {selectedAdsets.size > 0 && (
        <Section title="Ads" count={adAggs.length}>
          <Table rows={adAggs} cols={cols} level="ad" />
        </Section>
      )}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────
function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="px-4 py-2.5 border-b border-line flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium">{title}</h2>
          <span className="text-2xs text-muted">
            {count} {count === 1 ? "linha" : "linhas"}
          </span>
        </div>
        {hint && <span className="text-2xs text-muted">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function Table({
  rows,
  cols,
  level,
  selectedIds,
  onToggle,
}: {
  rows: CampaignAgg[];
  cols: ColKey[];
  level: Level;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const selectable = selectedIds !== undefined && onToggle !== undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-text2 border-b border-line">
          <tr>
            {selectable && <th className="px-2 py-2 w-8" />}
            <th className="px-3 py-2.5 font-normal">
              {level === "campaign" ? "Campanha" : level === "adset" ? "Adset" : "Ad"}
            </th>
            {level === "campaign" && (
              <th className="px-3 py-2.5 font-normal">Classif.</th>
            )}
            {COLUMNS.filter((c) => cols.includes(c.key)).map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2.5 font-normal ${col.align === "right" ? "text-right" : ""}`}
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
                colSpan={cols.length + (selectable ? 2 : 1) + (level === "campaign" ? 1 : 0)}
                className="px-3 py-8 text-center text-muted"
              >
                Nada por aqui.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const id =
              level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id! : r.ad_id!;
            const isSelected = selectable && selectedIds!.has(id);
            const chip = level === "campaign" ? classificationChip(r.classification) : null;
            const name =
              level === "campaign"
                ? r.campaign_name
                : level === "adset"
                  ? r.adset_name ?? "(sem nome)"
                  : r.ad_name ?? "(sem nome)";
            const subline =
              level === "campaign"
                ? r.ad_account_name ?? r.campaign_id
                : level === "adset"
                  ? r.campaign_name
                  : r.adset_name ?? r.campaign_name;

            return (
              <tr
                key={id}
                className={`border-b border-line/40 transition cursor-${
                  selectable ? "pointer" : "default"
                } ${isSelected ? "bg-brand/5" : "hover:bg-surface2/30"}`}
                onClick={selectable ? () => onToggle!(id) : undefined}
              >
                {selectable && (
                  <td className="px-2 py-2.5 w-8 text-center">
                    <span
                      className={`inline-block w-4 h-4 rounded border ${
                        isSelected ? "bg-brand border-brand" : "border-line"
                      } grid place-items-center text-2xs text-text`}
                    >
                      {isSelected ? "✓" : ""}
                    </span>
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
                {COLUMNS.filter((c) => cols.includes(c.key)).map((col) => {
                  const value = col.compute(r);
                  const text = fmtCell(value, col.format);
                  const kind = col.format === "money" ? "money" : "count";
                  let cls = "";
                  if (col.highlight === "accent" && value && value > 0) cls += " text-accent font-medium";
                  if (col.format === "roas" && value != null) cls += value >= 1 ? " text-accent" : " text-warn";
                  if (col.key === "spend") cls += " font-medium";
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 ${col.align === "right" ? "text-right" : ""} ${cls}`}
                    >
                      {value == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <Hideable kind={kind}>{text}</Hideable>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
      params.set("cols", "_none");
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
