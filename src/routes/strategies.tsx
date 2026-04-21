import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, Stat, NumInput, fmt } from "@/components/ui-kit";
import { strategyPayoff, blackScholes, greeks, type Leg, type OptionType } from "@/lib/quant";


interface PresetLeg { type: OptionType | "stock"; strikeOffset: number; qty: number; }

const PRESETS: Record<string, PresetLeg[]> = {
  "Long Call": [{ type: "call", strikeOffset: 0, qty: 1 }],
  "Long Put":  [{ type: "put",  strikeOffset: 0, qty: 1 }],
  "Long Straddle": [
    { type: "call", strikeOffset: 0, qty: 1 },
    { type: "put",  strikeOffset: 0, qty: 1 },
  ],
  "Bull Call Spread": [
    { type: "call", strikeOffset: -5, qty: 1 },
    { type: "call", strikeOffset: 5,  qty: -1 },
  ],
  "Iron Condor": [
    { type: "put",  strikeOffset: -10, qty: 1 },
    { type: "put",  strikeOffset: -5,  qty: -1 },
    { type: "call", strikeOffset: 5,   qty: -1 },
    { type: "call", strikeOffset: 10,  qty: 1 },
  ],
  "Butterfly": [
    { type: "call", strikeOffset: -5, qty: 1 },
    { type: "call", strikeOffset: 0,  qty: -2 },
    { type: "call", strikeOffset: 5,  qty: 1 },
  ],
  "Covered Call": [
    { type: "stock", strikeOffset: 0, qty: 1 },
    { type: "call",  strikeOffset: 5, qty: -1 },
  ],
};

export default function StrategyPage() {
  useEffect(() => {
    document.title = "Strategy Builder — Quantum Lab";
  }, []);
  const [S, setS] = useState(100);
  const [Tdays, setTdays] = useState(45);
  const [sigmaPct, setSigmaPct] = useState(25);
  const [presetName, setPresetName] = useState("Iron Condor");

  const legs = useMemo<Leg[]>(() => {
    const T = Tdays / 365, sigma = sigmaPct / 100;
    return PRESETS[presetName].map((p) => {
      const K = S + p.strikeOffset;
      let premium = 0;
      if (p.type !== "stock") {
        premium = blackScholes({ S, K, T, r: 0.045, q: 0.015, sigma, type: p.type });
      }
      return { type: p.type, strike: K, qty: p.qty, premium };
    });
  }, [presetName, S, Tdays, sigmaPct]);

  const data = useMemo(() => {
    const lo = S * 0.7, hi = S * 1.3;
    const arr = [];
    for (let i = 0; i <= 120; i++) {
      const spot = lo + (hi - lo) * (i / 120);
      const expiry = strategyPayoff(legs, spot);

      // Theoretical P&L now (T-0): mark-to-market at current vol/time
      const T = Tdays / 365, sigma = sigmaPct / 100;
      let now = 0;
      for (const leg of legs) {
        if (leg.type === "stock") {
          now += leg.qty * (spot - leg.strike);
        } else {
          const px = blackScholes({ S: spot, K: leg.strike, T, r: 0.045, q: 0.015, sigma, type: leg.type });
          now += leg.qty * px - leg.qty * leg.premium;
        }
      }
      arr.push({ spot: +spot.toFixed(2), expiry: +expiry.toFixed(3), now: +now.toFixed(3) });
    }
    return arr;
  }, [legs, S, Tdays, sigmaPct]);

  // Aggregate Greeks at current spot
  const aggG = useMemo(() => {
    const T = Tdays / 365, sigma = sigmaPct / 100;
    let delta = 0, gamma = 0, vega = 0, theta = 0;
    for (const leg of legs) {
      if (leg.type === "stock") { delta += leg.qty; continue; }
      const g = greeks({ S, K: leg.strike, T, r: 0.045, q: 0.015, sigma, type: leg.type });
      delta += leg.qty * g.delta;
      gamma += leg.qty * g.gamma;
      vega  += leg.qty * g.vega;
      theta += leg.qty * g.theta;
    }
    return { delta, gamma, vega, theta };
  }, [legs, S, Tdays, sigmaPct]);

  const netDebit = legs.reduce((s, l) => s + (l.type === "stock" ? l.qty * l.strike : l.qty * l.premium), 0);
  const maxProfit = Math.max(...data.map((d) => d.expiry));
  const maxLoss = Math.min(...data.map((d) => d.expiry));

  // Find break-evens (sign change in expiry)
  const bes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if ((data[i - 1].expiry < 0 && data[i].expiry > 0) || (data[i - 1].expiry > 0 && data[i].expiry < 0)) {
      const s1 = data[i - 1].spot, s2 = data[i].spot;
      const v1 = data[i - 1].expiry, v2 = data[i].expiry;
      bes.push(s1 - v1 * (s2 - s1) / (v2 - v1));
    }
  }

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel title="Strategy" className="xl:col-span-3">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <NumInput label="Spot" value={S} onChange={setS} step={0.5} suffix="$" />
            <NumInput label="Days" value={Tdays} onChange={setTdays} step={1} min={1} suffix="DTE" />
            <NumInput label="Vol" value={sigmaPct} onChange={setSigmaPct} step={0.5} suffix="%" />
          </div>
          <div className="stat-label mb-1.5">Preset</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.keys(PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => setPresetName(name)}
                className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1.5 rounded border transition-all ${
                  presetName === name
                    ? "border-amber bg-amber/15 text-amber"
                    : "border-border bg-input text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={presetName} subtitle="Payoff & Mark-to-Market" className="xl:col-span-9">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                <XAxis dataKey="spot" stroke="oklch(0.68 0.02 250)" fontSize={10} />
                <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} formatter={(v) => fmt(Number(v), 3)} />
                <ReferenceLine y={0} stroke="oklch(0.50 0.025 250)" />
                <ReferenceLine x={S} stroke="oklch(0.78 0.16 75)" strokeDasharray="3 3" label={{ value: "Spot", fill: "oklch(0.78 0.16 75)", fontSize: 10 }} />
                {bes.map((be) => (
                  <ReferenceLine key={be} x={+be.toFixed(2)} stroke="oklch(0.78 0.13 215)" strokeDasharray="2 2" label={{ value: `BE ${be.toFixed(1)}`, fill: "oklch(0.78 0.13 215)", fontSize: 9, position: "top" }} />
                ))}
                <Line type="monotone" dataKey="expiry" stroke="oklch(0.78 0.16 75)" strokeWidth={2.5} dot={false} name="At Expiry" />
                <Line type="monotone" dataKey="now" stroke="oklch(0.78 0.13 215)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Now (T-0)" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Net Cost" value={`$${fmt(netDebit, 3)}`} accent={netDebit >= 0 ? "bear" : "bull"} hint={netDebit >= 0 ? "debit" : "credit"} />
            <Stat label="Max Profit" value={fmt(maxProfit, 3)} accent="bull" hint="@ expiry (range)" />
            <Stat label="Max Loss" value={fmt(maxLoss, 3)} accent="bear" hint="@ expiry (range)" />
            <Stat label="Break-evens" value={bes.length ? bes.map((b) => b.toFixed(1)).join(" · ") : "—"} accent="cyan" mono />
          </div>
        </Panel>

        <Panel title="Aggregate Greeks" subtitle="position-level risk @ current spot" className="xl:col-span-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Σ Delta" value={fmt(aggG.delta, 4)} accent={aggG.delta >= 0 ? "bull" : "bear"} />
            <Stat label="Σ Gamma" value={fmt(aggG.gamma, 5)} accent="amber" />
            <Stat label="Σ Vega" value={fmt(aggG.vega, 4)} accent="cyan" />
            <Stat label="Σ Theta" value={fmt(aggG.theta, 4)} accent={aggG.theta >= 0 ? "bull" : "bear"} hint="per day" />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
            Position Greeks are the qty-weighted sum of each leg's Greeks. Delta-neutral strategies
            (e.g. straddles, condors) have ~0 Δ but non-zero Γ, ν exposure — pure volatility plays.
          </p>
        </Panel>

        <Panel title="Leg Detail" className="xl:col-span-6">
          <table className="w-full text-xs num">
            <thead>
              <tr className="border-b border-border">
                {["Side", "Type", "Strike", "Qty", "Premium", "Cost"].map((h) => (
                  <th key={h} className="text-right p-2 stat-label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className={`text-right p-2 font-semibold ${leg.qty >= 0 ? "text-bull" : "text-bear"}`}>
                    {leg.qty >= 0 ? "LONG" : "SHORT"}
                  </td>
                  <td className="text-right p-2 uppercase text-amber">{leg.type}</td>
                  <td className="text-right p-2">${leg.strike.toFixed(2)}</td>
                  <td className="text-right p-2">{leg.qty}</td>
                  <td className="text-right p-2">{leg.type === "stock" ? "—" : fmt(leg.premium, 3)}</td>
                  <td className={`text-right p-2 ${leg.qty * leg.premium >= 0 ? "text-bear" : "text-bull"}`}>
                    {leg.type === "stock"
                      ? fmt(leg.qty * leg.strike, 2)
                      : fmt(leg.qty * leg.premium, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </TerminalShell>
  );
}
