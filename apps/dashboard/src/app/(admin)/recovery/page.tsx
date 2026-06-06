import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";
import { CopyPixButton } from "./copy-pix-button";

// ── Tipos ────────────────────────────────────────────────────
type LostKind =
  | "pix_pending"
  | "pix_expired"
  | "billet_pending"
  | "billet_expired"
  | "cart_abandoned";

interface LostRow {
  id: string;
  platform: "assiny" | "hotmart";
  kind: LostKind;
  email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  customer_id: string | null;
  product_name: string | null;
  offer_name: string | null;
  amount_cents: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  funnel_ref: string | null;
  event_source_url: string | null;
  payment_method: string | null;
  pix_qr_code: string | null;
  occurred_at: string;
  resolved: boolean;
}

type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom";
type Filter = "all" | "pending" | "expired" | "abandoned";

const BRT_OFFSET_MIN = 180;

function brtMidnightFromDateString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 3, 0, 0));
}

function periodStart(p: Period, from?: string): Date | null {
  if (p === "custom") return from ? brtMidnightFromDateString(from) : null;
  if (p === "all") return null;
  const nowLocalMs = Date.now() - BRT_OFFSET_MIN * 60_000;
  const local = new Date(nowLocalMs);
  local.setUTCHours(0, 0, 0, 0);
  if (p === "yesterday") local.setUTCDate(local.getUTCDate() - 1);
  else if (p === "7d") local.setUTCDate(local.getUTCDate() - 6);
  else if (p === "30d") local.setUTCDate(local.getUTCDate() - 29);
  else if (p === "month") local.setUTCDate(1);
  return new Date(local.getTime() + BRT_OFFSET_MIN * 60_000);
}

function periodEnd(p: Period, to?: string): Date | null {
  if (p === "yesterday") {
    const nowLocalMs = Date.now() - BRT_OFFSET_MIN * 60_000;
    const local = new Date(nowLocalMs);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() + BRT_OFFSET_MIN * 60_000);
  }
  if (p !== "custom" || !to) return null;
  const start = brtMidnightFromDateString(to);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60_000);
}

function parsePeriod(raw: string | undefined): Period {
  if (raw === "today" || raw === "yesterday" || raw === "7d" || raw === "30d" || raw === "month" || raw === "all" || raw === "custom") return raw;
  return "30d";
}

function parseFilter(raw: string | undefined): Filter {
  if (raw === "pending" || raw === "expired" || raw === "abandoned" || raw === "all") return raw;
  return "all";
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `há ${d}d`;
  return fmtDateTime(iso);
}

function kindChip(kind: LostKind) {
  switch (kind) {
    case "pix_pending":
      return { dot: "bg-info", label: "PIX aguardando" };
    case "billet_pending":
      return { dot: "bg-info", label: "Boleto aguardando" };
    case "pix_expired":
      return { dot: "bg-warn", label: "PIX expirado" };
    case "billet_expired":
      return { dot: "bg-warn", label: "Boleto expirado" };
    case "cart_abandoned":
      return { dot: "bg-muted", label: "Carrinho abandonado" };
  }
}

function kindBelongsToFilter(kind: LostKind, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "pending") return kind === "pix_pending" || kind === "billet_pending";
  if (f === "expired") return kind === "pix_expired" || kind === "billet_expired";
  if (f === "abandoned") return kind === "cart_abandoned";
  return false;
}

function buildQuery(sp: { period: Period; filter: Filter; from?: string; to?: string }): string {
  const p = new URLSearchParams();
  if (sp.period !== "30d") p.set("period", sp.period);
  if (sp.filter !== "all") p.set("filter", sp.filter);
  if (sp.from) p.set("from", sp.from);
  if (sp.to) p.set("to", sp.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function waLink(phoneNormalized: string | null): string | null {
  if (!phoneNormalized) return null;
  // phone_normalized é os últimos 11 dígitos. wa.me precisa do prefixo país.
  return `https://wa.me/55${phoneNormalized}`;
}

async function listLost(filters: {
  startISO?: string;
  endISO?: string;
  filter: Filter;
}): Promise<LostRow[]> {
  const sb = createSupabaseAdmin();
  let q = sb
    .from("lost_purchases")
    .select(
      `id, platform, kind, email, phone, phone_normalized, customer_id,
       product_name, offer_name, amount_cents,
       utm_source, utm_medium, utm_campaign,
       funnel_ref, event_source_url, payment_method, pix_qr_code,
       occurred_at, resolved`,
    )
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (filters.startISO) q = q.gte("occurred_at", filters.startISO);
  if (filters.endISO) q = q.lt("occurred_at", filters.endISO);

  if (filters.filter === "pending") q = q.in("kind", ["pix_pending", "billet_pending"]);
  else if (filters.filter === "expired") q = q.in("kind", ["pix_expired", "billet_expired"]);
  else if (filters.filter === "abandoned") q = q.eq("kind", "cart_abandoned");

  const { data } = await q;
  return (data ?? []) as unknown as LostRow[];
}

// ── Página ─────────────────────────────────────────────────
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; filter?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "recovery")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const filter = parseFilter(sp.filter);
  const start = periodStart(period, sp.from);
  const end = periodEnd(period, sp.to);

  const rows = await listLost({
    startISO: start?.toISOString(),
    endISO: end?.toISOString(),
    filter,
  });

  // Stats: sempre baseados em rows não-resolvidos (em aberto)
  const open = rows.filter((r) => !r.resolved);

  const pendingRows = open.filter(
    (r) => r.kind === "pix_pending" || r.kind === "billet_pending",
  );
  const expiredRows = open.filter(
    (r) => r.kind === "pix_expired" || r.kind === "billet_expired",
  );
  const abandonedRows = open.filter((r) => r.kind === "cart_abandoned");

  const sum = (arr: LostRow[]) => arr.reduce((acc, r) => acc + r.amount_cents, 0);

  const pendingValue = sum(pendingRows);
  const expiredValue = sum(expiredRows);
  const totalLost = expiredValue + sum(abandonedRows);

  const filtered = rows.filter((r) => kindBelongsToFilter(r.kind, filter));

  return (
    <>
      <PageHeader
        title="Recuperação"
        subtitle="PIX/boleto pendente, expirado e carrinho abandonado"
        right={
          <div className="flex flex-wrap gap-1.5">
            {(["today", "yesterday", "7d", "30d", "month", "all"] as Period[]).map((p) => {
              const label = p === "today" ? "Hoje" : p === "yesterday" ? "Ontem" : p === "month" ? "Mês" : p === "all" ? "Tudo" : p;
              const active = period === p;
              return (
                <Link
                  key={p}
                  href={`/recovery${buildQuery({ period: p, filter, from: sp.from, to: sp.to })}`}
                  className={`btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
                >
                  {label}
                </Link>
              );
            })}
            <details className="relative">
              <summary className={`btn-sm ${period === "custom" ? "btn-primary" : "btn-ghost"} list-none cursor-pointer`}>
                📅 Personalizado
              </summary>
              <form className="absolute right-0 mt-2 z-10 card p-3 w-72 space-y-2" action="/recovery">
                <input type="hidden" name="period" value="custom" />
                <input type="hidden" name="filter" value={filter} />
                <label className="block">
                  <span className="label">De</span>
                  <input type="date" name="from" defaultValue={sp.from} className="input" />
                </label>
                <label className="block">
                  <span className="label">Até</span>
                  <input type="date" name="to" defaultValue={sp.to} className="input" />
                </label>
                <button type="submit" className="btn btn-primary w-full">Aplicar</button>
              </form>
            </details>
          </div>
        }
      />

      <PageBody>
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Em aberto"
            value={<Hideable kind="money">{fmtMoney(pendingValue)}</Hideable>}
            hint={<Hideable kind="count">{`${pendingRows.length} aguardando pagamento`}</Hideable>}
          />
          <StatCard
            label="Expirado"
            value={<Hideable kind="money">{fmtMoney(expiredValue)}</Hideable>}
            hint={<Hideable kind="count">{`${expiredRows.length} expiraram sem pagar`}</Hideable>}
          />
          <StatCard
            label="Carrinho abandonado"
            value={<Hideable kind="count">{String(abandonedRows.length)}</Hideable>}
            hint="saíram sem gerar pagamento"
          />
          <StatCard
            label="Total perdido"
            value={<Hideable kind="money">{fmtMoney(totalLost)}</Hideable>}
            hint="expirado + abandonado no período"
          />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "pending", "expired", "abandoned"] as Filter[]).map((f) => {
            const label =
              f === "all" ? "Tudo" :
              f === "pending" ? "Aguardando" :
              f === "expired" ? "Expirado" :
              "Abandonado";
            const active = filter === f;
            return (
              <Link
                key={f}
                href={`/recovery${buildQuery({ period, filter: f, from: sp.from, to: sp.to })}`}
                className={`btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Tabela */}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text2 border-b border-line">
              <tr>
                <th className="px-3 py-2.5 font-normal">Quando</th>
                <th className="px-3 py-2.5 font-normal">Status</th>
                <th className="px-3 py-2.5 font-normal">Cliente</th>
                <th className="px-3 py-2.5 font-normal">Produto</th>
                <th className="px-3 py-2.5 font-normal text-right">Valor</th>
                <th className="px-3 py-2.5 font-normal">Origem</th>
                <th className="px-3 py-2.5 font-normal">Plataforma</th>
                <th className="px-3 py-2.5 font-normal text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted">
                    Nenhuma venda perdida no período.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const chip = kindChip(r.kind);
                const wa = waLink(r.phone_normalized);
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-line/40 hover:bg-surface2/30 ${r.resolved ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="text-text">{timeAgo(r.occurred_at)}</div>
                      <div className="text-2xs text-muted">{fmtDateTime(r.occurred_at)}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="chip">
                        <span className={`dot ${chip.dot}`} />
                        {chip.label}
                      </span>
                      {r.resolved && (
                        <div className="text-2xs text-accent mt-1">✓ resolvido</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {r.customer_id && (
                          <span title="Já é cliente" className="text-accent text-xs">●</span>
                        )}
                        {r.customer_id ? (
                          <Link
                            href={`/customers/${r.customer_id}`}
                            className="text-text hover:text-brand"
                          >
                            <Hideable kind="email">{r.email ?? "(sem email)"}</Hideable>
                          </Link>
                        ) : (
                          <span className="text-text">
                            <Hideable kind="email">{r.email ?? "(sem email)"}</Hideable>
                          </span>
                        )}
                      </div>
                      {r.phone && (
                        <div className="text-2xs text-muted">
                          <Hideable kind="phone">{r.phone}</Hideable>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-text">{r.product_name ?? "—"}</div>
                      {r.offer_name && r.offer_name !== r.product_name && (
                        <div className="text-2xs text-muted">{r.offer_name}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      <Hideable kind="money">{fmtMoney(r.amount_cents)}</Hideable>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-text2 text-xs">
                        {r.utm_source ?? "—"}
                        {r.utm_campaign && ` · ${r.utm_campaign}`}
                      </div>
                      {r.funnel_ref && (
                        <div className="text-2xs text-muted font-mono">{r.funnel_ref}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-text2 capitalize">{r.platform}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.pix_qr_code && <CopyPixButton code={r.pix_qr_code} />}
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-sm btn-ghost"
                            title="Abrir WhatsApp"
                          >
                            WhatsApp
                          </a>
                        )}
                        {r.event_source_url && (
                          <a
                            href={r.event_source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-sm btn-ghost"
                            title="Ver checkout"
                          >
                            Checkout
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-2xs text-muted">
          {filtered.length} {filtered.length === 1 ? "registro" : "registros"} · até 500 últimos
        </div>
      </PageBody>
    </>
  );
}
