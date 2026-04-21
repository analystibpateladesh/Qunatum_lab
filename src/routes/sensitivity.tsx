import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, Legend,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, NumInput, Toggle, fmt } from "@/components/ui-kit";
import { greeks, type OptionParams, type OptionType } from "@/lib/quant";


const GREEK_DEFS: { key: keyof ReturnType<typeof greeks>; label: string; color: string; }[] = [
  { key: "delta", label: "Δ Delta", color: "oklch(0.78 0.16 75)" },
  { key: "gamma", label: "Γ Gamma × 10", color: "oklch(0.78 0.13 215)" },
  { key: "vega",  label: "ν Vega", color: "oklch(0.74 0.18 145)" },
  { key: "theta", label: "Θ Theta × 50", color: "oklch(0.65 0.24 25)" },
  { key: "rho",   label: "ρ Rho", color: "oklch(0.70 0.20 325)" },
];

export default function SensitivityPage() {
  useEffect(() => {
    document.title = "Greeks Sensitivity — Quantum Lab";
  }, []);
  const [S, setS] = useState(100);
  const [K, setK] = useState(100);
  const [Tdays, setTdays] = useState(60);
  const [sigmaPct, setSigmaPct] = useState(25);
  const [type, setType] = useState<OptionType>("call");
  const [xAxis, setXAxis] = useState<"spot" | "time" | "vol">("spot");

  const baseParams = useMemo<OptionParams>(() => ({
    S, K, T: Tdays / 365, r: 0.045, q: 0.015, sigma: sigmaPct / 100, type,
  }), [S, K, Tdays, sigmaPct, type]);

  const series = useMemo(() => {
    const out: any[] = [];
    if (xAxis === "spot") {
      const lo = K * 0.5, hi = K * 1.5;
      for (let i = 0; i <= 80; i++) {
        const s = lo + (hi - lo) * (i / 80);
        const g = greeks({ ...baseParams, S: s });
        out.push({ x: +s.toFixed(2), delta: g.delta, gamma: g.gamma * 10, vega: g.vega, theta: g.theta * 50, rho: g.rho });
      }
    } else if (xAxis === "time") {
      for (let d = 1; d <= 365; d += 4) {
        const g = greeks({ ...baseParams, T: d / 365 });
        out.push({ x: d, delta: g.delta, gamma: g.gamma * 10, vega: g.vega, theta: g.theta * 50, rho: g.rho });
      }
    } else {
      for (let v = 5; v <= 100; v += 1) {
        const g = greeks({ ...baseParams, sigma: v / 100 });
        out.push({ x: v, delta: g.delta, gamma: g.gamma * 10, vega: g.vega, theta: g.theta * 50, rho: g.rho });
      }
    }
    return out;
  }, [baseParams, xAxis, K]);

  const xKey = xAxis === "spot" ? "Spot ($)" : xAxis === "time" ? "Days to Expiry" : "Vol (%)";
  const refX = xAxis === "spot" ? S : xAxis === "time" ? Tdays : sigmaPct;

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel title="Base Contract" className="xl:col-span-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-center justify-between">
              <span className="stat-label">Type</span>
              <Toggle value={type} onChange={(v) => setType(v as OptionType)}
                options={[{ value: "call", label: "Call" }, { value: "put", label: "Put" }]} />
            </div>
            <NumInput label="Spot" value={S} onChange={setS} step={0.5} suffix="$" />
            <NumInput label="Strike" value={K} onChange={setK} step={0.5} suffix="$" />
            <NumInput label="Days" value={Tdays} onChange={setTdays} step={1} min={1} suffix="DTE" />
            <NumInput label="Vol" value={sigmaPct} onChange={setSigmaPct} step={0.5} suffix="%" />
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <div className="stat-label mb-2">X-Axis</div>
            <Toggle value={xAxis} onChange={(v) => setXAxis(v as any)}
              options={[
                { value: "spot", label: "S" },
                { value: "time", label: "T" },
                { value: "vol", label: "σ" },
              ]} />
          </div>
          <div className="mt-4 text-[11px] text-muted-foreground leading-relaxed">
            <p className="mb-1"><span className="text-amber">▸</span> Gamma scaled ×10 for visibility</p>
            <p className="mb-1"><span className="text-bear">▸</span> Theta scaled ×50 (per-day)</p>
            <p><span className="text-cyan">▸</span> All Greeks recomputed analytically (closed-form)</p>
          </div>
        </Panel>

        <Panel title="Greeks Sensitivity" subtitle={`vs ${xKey}`} className="xl:col-span-9">
          <div className="h-[460px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                <XAxis dataKey="x" stroke="oklch(0.68 0.02 250)" fontSize={10} label={{ value: xKey, position: "insideBottom", offset: -4, fill: "oklch(0.68 0.02 250)", fontSize: 10 }} />
                <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} formatter={(v) => fmt(Number(v), 4)} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <ReferenceLine x={refX} stroke="oklch(0.78 0.16 75)" strokeDasharray="3 3" />
                <ReferenceLine y={0} stroke="oklch(0.40 0.025 250)" />
                {GREEK_DEFS.map((g) => (
                  <Line key={g.key} type="monotone" dataKey={g.key} stroke={g.color} strokeWidth={2} dot={false} name={g.label} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </TerminalShell>
  );
}
