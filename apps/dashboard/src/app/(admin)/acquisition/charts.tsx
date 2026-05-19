"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface DailyPoint {
  date: string;          // ISO date "2026-05-19"
  receita: number;
  reembolsos: number;
  margem: number;
}

interface PaymentDailyPoint {
  date: string;
  pix: number;
  cartao: number;
  boleto: number;
  outros: number;
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1000) {
    return `R$ ${(n / 1000).toFixed(1)}k`;
  }
  return `R$ ${n.toFixed(0)}`;
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const COLORS = {
  receita: "#ec2d7c",
  reembolsos: "#ef4444",
  margem: "#22c55e",
  pix: "#22c55e",
  cartao: "#3b82f6",
  boleto: "#fbbf24",
  outros: "#737373",
  grid: "#262626",
  axis: "#737373",
  text: "#a3a3a3",
};

function TooltipBox({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; name?: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-surface border border-line rounded-md p-2 shadow-lg text-xs">
      <div className="text-text2 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 tabular-nums">
          <span className="dot" style={{ background: p.color }} />
          <span className="text-text2">{p.name}:</span>
          <span className="text-text">R$ {Number(p.value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      ))}
    </div>
  );
}

export function RevenueChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="w-full h-72">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDay}
            stroke={COLORS.axis}
            tick={{ fontSize: 11, fill: COLORS.text }}
          />
          <YAxis
            stroke={COLORS.axis}
            tick={{ fontSize: 11, fill: COLORS.text }}
            tickFormatter={fmtMoney}
          />
          <Tooltip
            content={<TooltipBox />}
            labelFormatter={(l) => fmtDay(String(l))}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: COLORS.text }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="receita" name="Faturamento" fill={COLORS.receita} radius={[2, 2, 0, 0]} />
          <Bar dataKey="reembolsos" name="Reembolsos" fill={COLORS.reembolsos} radius={[2, 2, 0, 0]} />
          <Line
            type="monotone"
            dataKey="margem"
            name="Margem de contribuição"
            stroke={COLORS.margem}
            strokeWidth={2}
            dot={{ r: 3, fill: COLORS.margem }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaymentMethodChart({ data }: { data: PaymentDailyPoint[] }) {
  return (
    <div className="w-full h-72">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDay}
            stroke={COLORS.axis}
            tick={{ fontSize: 11, fill: COLORS.text }}
          />
          <YAxis
            stroke={COLORS.axis}
            tick={{ fontSize: 11, fill: COLORS.text }}
            tickFormatter={fmtMoney}
          />
          <Tooltip
            content={<TooltipBox />}
            labelFormatter={(l) => fmtDay(String(l))}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: COLORS.text }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="pix" name="PIX" stackId="a" fill={COLORS.pix} />
          <Bar dataKey="cartao" name="Cartão" stackId="a" fill={COLORS.cartao} />
          <Bar dataKey="boleto" name="Boleto" stackId="a" fill={COLORS.boleto} />
          <Bar dataKey="outros" name="Outros" stackId="a" fill={COLORS.outros} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface PaymentTotal { name: string; value: number; color: string }

export function PaymentPie({ data }: { data: PaymentTotal[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div className="text-sm text-muted text-center py-12">Sem vendas no período.</div>;
  }
  return (
    <div className="w-full h-56 flex items-center gap-4">
      <div className="w-44 h-44">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={70}
              paddingAngle={2}
            >
              {data.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} stroke="transparent" />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2">
        {data.map((d) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div key={d.name} className="flex items-center gap-2 text-sm">
              <span className="dot" style={{ background: d.color }} />
              <span className="text-text2 flex-1">{d.name}</span>
              <span className="text-text tabular-nums">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
