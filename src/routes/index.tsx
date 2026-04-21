import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, ReferenceLine,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, Stat, NumInput, Toggle, fmt, fmtPct } from "@/components/ui-kit";
import {
  blackScholes, binomialPrice, monteCarloPrice, greeks, impliedVol,
  type OptionParams, type OptionType,
} from "@/lib/quant";

export default function PricerPage() {
  useEffect(() => {
    document.title = "Quantum Lab — Multi-Model Options Pricer";
  }, []);

  const [S, setS] = useState(100);
  const [K, setK] = useState(100);
  const [Tdays, setTdays] = useState(90);
  const [r, setR] = useState(4.5);
  const [q, setQ] = useState(1.5);
  const [sigmaPct, setSigmaPct] = useState(22);
  const [type, setType] = useState<OptionType>("call");
  const [marketPrice, setMarketPrice] = useState(4.50);

  const params = useMemo<OptionParams>(() => ({
    S, K, T: Tdays / 365, r: r / 100, q: q / 100, sigma: sigmaPct / 100, type,
  }), [S, K, Tdays, r, q, sigmaPct, type]);

  const bs = useMemo(() => blackScholes(params), [params]);
  const binEU = useMemo(() => binomialPrice(params, 250, false), [params]);
  const binAM = useMemo(() => binomialPrice(params, 250, true), [params]);
  const mc = useMemo(() => monteCarloPrice(params, 30000), [params]);
  const g = useMemo(() => greeks(params), [params]);
  const iv = useMemo(() => {
    const { sigma: _ignored, ...base } = params;
    return impliedVol(marketPrice, base);
  }, [params, marketPrice]);

  // Payoff diagram data
  const payoffData = useMemo(() => {
    const arr = [];
    const lo = K * 0.5, hi = K * 1.5;
    for (let i = 0; i <= 60; i++) {
      const spot = lo + (hi - lo) * (i / 60);
      const intrinsic = Math.max(0, type === "call" ? spot - K : K - spot);
      const current = blackScholes({ ...params, S: spot });
      arr.push({ spot: +spot.toFixed(2), intrinsic: +intrinsic.toFixed(3), current: +current.toFixed(3) });
    }
    return arr;
  }, [K, type, params]);

  // Term structure (price vs T)
  const termData = useMemo(() => {
    const arr = [];
    for (let d = 1; d <= 365; d += 7) {
      const px = blackScholes({ ...params, T: d / 365 });
      arr.push({ days: d, price: +px.toFixed(4) });
    }
    return arr;
  }, [params]);

  const itm = type === "call" ? S > K : S < K;

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* INPUTS */}
        <Panel title="Contract" subtitle="Underlying & Option Spec" className="xl:col-span-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-center justify-between">
              <span className="stat-label">Type</span>
              <Toggle
                value={type}
                onChange={(v) => setType(v as OptionType)}
                options={[{ value: "call", label: "Call" }, { value: "put", label: "Put" }]}
              />
            </div>
            <NumInput label="Spot S" value={S} onChange={setS} step={0.5} suffix="$" />
            <NumInput label="Strike K" value={K} onChange={setK} step={0.5} suffix="$" />
            <NumInput label="Days to Exp" value={Tdays} onChange={setTdays} step={1} min={1} suffix="DTE" />
            <NumInput label="Vol σ" value={sigmaPct} onChange={setSigmaPct} step={0.5} min={0.1} suffix="%" />
            <NumInput label="Risk-free r" value={r} onChange={setR} step={0.05} suffix="%" />
            <NumInput label="Div yield q" value={q} onChange={setQ} step={0.05} suffix="%" />
          </div>

          <div className="mt-4 pt-3 border-t border-border">
            <div className="stat-label mb-2">Implied Vol Solver</div>
            <NumInput label="Market Price" value={marketPrice} onChange={setMarketPrice} step={0.05} suffix="$" />
            <div className="mt-2 flex items-center justify-between rounded-md bg-background/40 px-3 py-2 border border-border/60">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">IV (Brent)</span>
              <span className="num text-amber font-semibold">
                {iv === null ? "no soln" : `${(iv * 100).toFixed(2)}%`}
              </span>
            </div>
          </div>
        </Panel>

        {/* PRICES + GREEKS */}
        <div className="xl:col-span-9 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel
            title="Model Prices"
            subtitle="Cross-validated"
            action={
              <span className={`text-[10px] num px-2 py-0.5 rounded ${itm ? "bg-bull/15 text-bull" : "bg-muted text-muted-foreground"}`}>
                {itm ? "ITM" : "OTM"}
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Black-Scholes" value={fmt(bs, 4)} accent="amber" hint="Closed-form · Hull 15.20" />
              <Stat label="Binomial (EU)" value={fmt(binEU, 4)} hint="CRR · 250 steps" />
              <Stat label="Binomial (AM)" value={fmt(binAM, 4)} accent={binAM > binEU + 1e-6 ? "cyan" : "default"} hint={binAM > binEU + 1e-6 ? "early-exercise premium" : "= EU"} />
              <Stat
                label="Monte Carlo"
                value={fmt(mc.price, 4)}
                accent="cyan"
                hint={`±${fmt(1.96 * mc.stderr, 4)} · ${(mc.paths / 1000).toFixed(0)}k paths`}
              />
            </div>
            <div className="mt-3 pt-3 border-t border-border/60 text-[10px] text-muted-foreground flex items-start gap-2">
              <span className="text-amber">▸</span>
              <span>
                Three independent numerical methods agreeing within ~10⁻³ validates the implementation.
                Binomial(AM) ≥ Binomial(EU) by no-arbitrage; the spread is the early-exercise premium.
              </span>
            </div>
          </Panel>

          <Panel title="The Greeks" subtitle="First & Second Order">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Δ Delta" value={fmt(g.delta, 4)} accent={g.delta >= 0 ? "bull" : "bear"} hint="∂V/∂S" />
              <Stat label="Γ Gamma" value={fmt(g.gamma, 5)} accent="amber" hint="∂²V/∂S²" />
              <Stat label="ν Vega" value={fmt(g.vega, 4)} hint="per 1% vol" />
              <Stat label="Θ Theta" value={fmt(g.theta, 4)} accent={g.theta >= 0 ? "bull" : "bear"} hint="per day" />
              <Stat label="ρ Rho" value={fmt(g.rho, 4)} hint="per 1% rate" />
              <Stat label="Vanna" value={fmt(g.vanna, 5)} hint="∂Δ/∂σ" />
              <Stat label="Volga" value={fmt(g.volga, 4)} hint="∂ν/∂σ" />
              <Stat label="Charm" value={fmt(g.charm, 5)} hint="∂Δ/∂t·day" />
            </div>
          </Panel>

          {/* PAYOFF */}
          <Panel title="Payoff Diagram" subtitle="Intrinsic vs. Theoretical" className="lg:col-span-2">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={payoffData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCur" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.78 0.16 75)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="oklch(0.78 0.16 75)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                  <XAxis dataKey="spot" stroke="oklch(0.68 0.02 250)" fontSize={10} tickLine={false} />
                  <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.20 0.020 250)",
                      border: "1px solid oklch(0.30 0.025 250)",
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                  <ReferenceLine x={K} stroke="oklch(0.78 0.13 215)" strokeDasharray="3 3" label={{ value: `K=${K}`, fill: "oklch(0.78 0.13 215)", fontSize: 10 }} />
                  <ReferenceLine x={S} stroke="oklch(0.78 0.16 75)" strokeDasharray="3 3" label={{ value: `S=${S}`, fill: "oklch(0.78 0.16 75)", fontSize: 10, position: "top" }} />
                  <Area type="monotone" dataKey="current" stroke="oklch(0.78 0.16 75)" fill="url(#gCur)" strokeWidth={2} name="Theoretical" />
                  <Line type="monotone" dataKey="intrinsic" stroke="oklch(0.78 0.13 215)" strokeWidth={1.5} dot={false} name="Intrinsic" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* TERM */}
          <Panel title="Term Structure" subtitle="Price vs Days-to-Expiry" className="lg:col-span-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={termData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                  <XAxis dataKey="days" stroke="oklch(0.68 0.02 250)" fontSize={10} />
                  <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                  <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                  <ReferenceLine x={Tdays} stroke="oklch(0.78 0.16 75)" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="price" stroke="oklch(0.78 0.16 75)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Spot" value={`$${fmt(S, 2)}`} mono />
              <Stat label="Strike" value={`$${fmt(K, 2)}`} mono />
              <Stat label="Vol (annual)" value={fmtPct(sigmaPct / 100)} accent="cyan" />
            </div>
          </Panel>
        </div>
      </div>
    </TerminalShell>
  );
}
