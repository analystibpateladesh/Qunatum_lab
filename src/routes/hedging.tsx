import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar,
  CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, Stat, NumInput, Toggle, fmt, fmtPct } from "@/components/ui-kit";
import { usePrices } from "@/hooks/usePrices";
import { logReturns, stdev, gauss, TRADING_DAYS } from "@/lib/stats";
import { blackScholes, greeks, type OptionType } from "@/lib/quant";


type StrategyType = "short_straddle" | "short_call" | "long_call";

interface Step {
  day: number;
  spot: number;
  optPx: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  hedge: number;     // shares held
  cash: number;
  pnl: number;
  // attribution (cumulative)
  deltaPL: number;
  gammaPL: number;
  vegaPL: number;
  thetaPL: number;
  unexplainedPL: number;
}

export default function HedgingPage() {
  useEffect(() => {
    document.title = "Delta-Hedging Backtester — Quantum Lab";
  }, []);
  const [symbol, setSymbol] = useState("SPY");
  const [dte, setDte] = useState(30);
  const [strategy, setStrategy] = useState<StrategyType>("short_straddle");
  const [hedgeFreq, setHedgeFreq] = useState(1);  // hedge every N days
  const [trCostBps, setTrCostBps] = useState(2);   // cost per share trade in bps of price
  const [seed, setSeed] = useState(0);

  const { data, loading, error } = usePrices(symbol);

  // Use realized vol from history as the assumed σ
  const sim = useMemo(() => {
    if (!data || !data.bars.length) return null;
    const closes = data.bars.slice(-252).map((b) => b.close);
    const rets = logReturns(closes);
    const sigma = stdev(rets) * Math.sqrt(TRADING_DAYS);
    const S0 = closes[closes.length - 1];
    const r = 0.045, q = 0.0;
    const T0 = dte / 365;
    const K = S0;  // ATM

    // ── Build legs ──
    type Leg = { type: OptionType; qty: number };
    const legs: Leg[] =
      strategy === "short_straddle" ? [{ type: "call", qty: -1 }, { type: "put", qty: -1 }] :
      strategy === "short_call"     ? [{ type: "call", qty: -1 }] :
                                      [{ type: "call", qty:  1 }];

    const portfolioPrice = (S: number, T: number, sig: number) =>
      legs.reduce((s, l) => s + l.qty * blackScholes({ S, K, T, r, q, sigma: sig, type: l.type }), 0);
    const portfolioGreeks = (S: number, T: number, sig: number) => {
      let d = 0, g = 0, v = 0, th = 0;
      for (const l of legs) {
        const gk = greeks({ S, K, T, r, q, sigma: sig, type: l.type });
        d += l.qty * gk.delta; g += l.qty * gk.gamma; v += l.qty * gk.vega; th += l.qty * gk.theta;
      }
      return { delta: d, gamma: g, vega: v, theta: th };
    };

    // Simulate GBM path under realized sigma
    // Seed with simple PRNG to keep deterministic per `seed`
    let s = (seed * 9301 + 49297) % 233280;
    const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const gaussSeeded = () => {
      let u = 0, v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    const dt = 1 / 365;
    const drift = (r - q - 0.5 * sigma * sigma) * dt;
    const diff = sigma * Math.sqrt(dt);

    // Initial state
    const initOptPx = portfolioPrice(S0, T0, sigma);
    const initG = portfolioGreeks(S0, T0, sigma);
    // Hedge: buy -delta shares to neutralize
    let hedge = -initG.delta;
    const optPremium = initOptPx;   // if short, we receive |premium|; pnl includes this as starting cash
    let cash = -optPremium - hedge * S0;  // we receive -optPx (since legs sum negative for shorts) and pay for hedge

    let cumDelta = 0, cumGamma = 0, cumVega = 0, cumTheta = 0;
    const path: Step[] = [{
      day: 0, spot: S0, optPx: initOptPx,
      delta: initG.delta, gamma: initG.gamma, vega: initG.vega, theta: initG.theta,
      hedge, cash, pnl: 0, deltaPL: 0, gammaPL: 0, vegaPL: 0, thetaPL: 0, unexplainedPL: 0,
    }];

    let S = S0;
    let prevG = initG;
    let prevOptPx = initOptPx;

    for (let day = 1; day <= dte; day++) {
      const z = gaussSeeded();
      const Snew = S * Math.exp(drift + diff * z);
      const dS = Snew - S;
      const Trem = (dte - day) / 365;

      // Mark-to-market option at new spot/time (vol assumed constant for this BT)
      const newOptPx = portfolioPrice(Snew, Trem, sigma);
      const newG = portfolioGreeks(Snew, Trem, sigma);

      // PnL attribution (Taylor expansion)
      const dT_days = 1;  // one day passed
      const dPL_delta = prevG.delta * dS;
      const dPL_gamma = 0.5 * prevG.gamma * dS * dS;
      const dPL_vega  = 0;                        // sigma constant in this BT
      const dPL_theta = prevG.theta * dT_days;    // theta is per-day

      const dPL_actual = newOptPx - prevOptPx;
      const dPL_unexp = dPL_actual - (dPL_delta + dPL_gamma + dPL_vega + dPL_theta);

      cumDelta += dPL_delta;
      cumGamma += dPL_gamma;
      cumVega  += dPL_vega;
      cumTheta += dPL_theta;
      
      // Cash from hedge: hedge stays constant between rebalances; earns dS * hedge as P&L.
      // (We're tracking option-position P&L; total hedged P&L = option P&L + hedge*dS )
      cash *= Math.exp(r * dt);  // interest on cash

      // Rebalance hedge?
      let tradedShares = 0;
      if (day % hedgeFreq === 0 || day === dte) {
        const target = -newG.delta;
        tradedShares = target - hedge;
        const cost = Math.abs(tradedShares) * Snew * (trCostBps / 10000);
        cash -= tradedShares * Snew + cost;
        hedge = target;
      }

      // Total position MTM = received cash + hedge value + option position MTM
      // option position MTM = -newOptPx (we sold it) -> but we modeled portfolioPrice as signed legs already
      // Convention: positive optPx = we OWN; here legs may be net short → optPx negative. portfolio value = optPx + hedge*S + cash
      const positionValue = newOptPx + hedge * Snew + cash;
      const pnl = positionValue;  // initial value was 0 by construction

      path.push({
        day, spot: +Snew.toFixed(3), optPx: +newOptPx.toFixed(4),
        delta: newG.delta, gamma: newG.gamma, vega: newG.vega, theta: newG.theta,
        hedge: +hedge.toFixed(4), cash: +cash.toFixed(2), pnl: +pnl.toFixed(3),
        deltaPL: +cumDelta.toFixed(3), gammaPL: +cumGamma.toFixed(3),
        vegaPL: +cumVega.toFixed(3), thetaPL: +cumTheta.toFixed(3),
        unexplainedPL: +(pnl - cumDelta - cumGamma - cumVega - cumTheta).toFixed(3),
      });

      S = Snew;
      prevG = newG;
      prevOptPx = newOptPx;
    }

    const finalPL = path[path.length - 1].pnl;
    const totalTrades = Math.ceil(dte / hedgeFreq);

    return {
      path, sigma, S0, K, optPremium,
      finalPL,
      totalTrades,
      // Aggregate attribution at expiry
      deltaPL: path[path.length - 1].deltaPL,
      gammaPL: path[path.length - 1].gammaPL,
      thetaPL: path[path.length - 1].thetaPL,
    };
  }, [data, dte, strategy, hedgeFreq, trCostBps, seed]);

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel title="Backtest Setup" className="xl:col-span-3">
          <div className="space-y-3">
            <div>
              <div className="stat-label mb-1">Underlying</div>
              <div className="flex gap-2">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="num bg-input border border-border rounded-md px-2.5 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-amber"
                />
              </div>
            </div>

            <div>
              <div className="stat-label mb-1">Strategy</div>
              <Toggle
                value={strategy}
                onChange={(v) => setStrategy(v as StrategyType)}
                options={[
                  { value: "short_straddle", label: "Short Strdl" },
                  { value: "short_call", label: "Short Call" },
                  { value: "long_call", label: "Long Call" },
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumInput label="DTE" value={dte} onChange={setDte} step={1} min={5} max={120} suffix="days" />
              <NumInput label="Hedge Freq" value={hedgeFreq} onChange={setHedgeFreq} step={1} min={1} max={30} suffix="days" />
              <NumInput label="Tx Cost" value={trCostBps} onChange={setTrCostBps} step={0.5} min={0} suffix="bps" />
              <NumInput label="Seed" value={seed} onChange={setSeed} step={1} min={0} suffix="" />
            </div>

            <button
              onClick={() => setSeed(seed + 1)}
              className="w-full py-2 text-xs font-bold uppercase tracking-wider rounded bg-amber text-primary-foreground hover:opacity-90"
            >
              ▸ Re-run Path
            </button>

            <div className="text-[11px] text-muted-foreground leading-relaxed pt-3 border-t border-border">
              <p><span className="text-amber">▸</span> σ from realized 1Y vol of {symbol}</p>
              <p><span className="text-cyan">▸</span> Path simulated under GBM (seeded)</p>
              <p><span className="text-bull">▸</span> P&L decomposed: Δ·dS + ½Γ·dS² + Θ·dt</p>
            </div>
          </div>
        </Panel>

        <div className="xl:col-span-9 grid gap-3">
          {loading && <Panel title="Loading"><div className="text-sm text-muted-foreground">Fetching {symbol}…</div></Panel>}
          {error && <Panel title="Error"><div className="text-sm text-bear">{error}</div></Panel>}

          {sim && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                <Stat label="Realized σ" value={fmtPct(sim.sigma)} accent="cyan" hint={`from ${symbol} 1Y`} />
                <Stat label="Spot S₀" value={`$${fmt(sim.S0, 2)}`} accent="amber" />
                <Stat label="Strike K" value={`$${fmt(sim.K, 2)}`} hint="ATM" />
                <Stat label="Premium" value={`$${fmt(Math.abs(sim.optPremium), 3)}`} hint={sim.optPremium < 0 ? "received" : "paid"} />
                <Stat label="Final P&L" value={`$${fmt(sim.finalPL, 3)}`} accent={sim.finalPL >= 0 ? "bull" : "bear"} hint="per contract" />
                <Stat label="Trades" value={sim.totalTrades} hint="rebalances" />
              </div>

              <Panel title="Cumulative P&L Attribution" subtitle="decomposed by Greek">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sim.path} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                      <XAxis dataKey="day" stroke="oklch(0.68 0.02 250)" fontSize={10} />
                      <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                      <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke="oklch(0.50 0.025 250)" />
                      <Line type="monotone" dataKey="pnl" stroke="oklch(0.78 0.16 75)" strokeWidth={2.5} dot={false} name="Total P&L" />
                      <Line type="monotone" dataKey="deltaPL" stroke="oklch(0.78 0.13 215)" strokeWidth={1.5} dot={false} name="Δ·dS" />
                      <Line type="monotone" dataKey="gammaPL" stroke="oklch(0.74 0.18 145)" strokeWidth={1.5} dot={false} name="½Γ·dS²" />
                      <Line type="monotone" dataKey="thetaPL" stroke="oklch(0.65 0.24 25)" strokeWidth={1.5} dot={false} name="Θ·dt" />
                      <Line type="monotone" dataKey="unexplainedPL" stroke="oklch(0.70 0.20 325)" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Unexplained" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Panel title="Underlying Path" subtitle="simulated GBM">
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sim.path} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                        <XAxis dataKey="day" stroke="oklch(0.68 0.02 250)" fontSize={10} />
                        <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                        <ReferenceLine y={sim.K} stroke="oklch(0.78 0.13 215)" strokeDasharray="3 3" label={{ value: "K", fill: "oklch(0.78 0.13 215)", fontSize: 10 }} />
                        <Line type="monotone" dataKey="spot" stroke="oklch(0.78 0.16 75)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                <Panel title="Hedge Position" subtitle="shares held vs delta">
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={sim.path} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                        <XAxis dataKey="day" stroke="oklch(0.68 0.02 250)" fontSize={10} />
                        <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                        <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={0} stroke="oklch(0.50 0.025 250)" />
                        <Line type="stepAfter" dataKey="hedge" stroke="oklch(0.78 0.16 75)" strokeWidth={2} dot={false} name="Shares" />
                        <Line type="monotone" dataKey="delta" stroke="oklch(0.78 0.13 215)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="-Δ target" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </div>

              <Panel title="Attribution Summary" subtitle="components of final P&L">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Δ contribution" value={`$${fmt(sim.deltaPL, 3)}`} accent={sim.deltaPL >= 0 ? "bull" : "bear"} hint="directional" />
                  <Stat label="Γ contribution" value={`$${fmt(sim.gammaPL, 3)}`} accent={sim.gammaPL >= 0 ? "bull" : "bear"} hint="convexity" />
                  <Stat label="Θ contribution" value={`$${fmt(sim.thetaPL, 3)}`} accent={sim.thetaPL >= 0 ? "bull" : "bear"} hint="time decay" />
                  <Stat label="Hedge cost" value={`$${fmt(sim.finalPL - sim.deltaPL - sim.gammaPL - sim.thetaPL, 3)}`} hint="frictions + jump" />
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                  <span className="text-amber font-semibold">Key insight:</span> for a delta-hedged short straddle,
                  the expected P&L is the gap between <em>realized</em> and <em>implied</em> volatility — collected
                  through theta decay and paid out via gamma losses. When realized {">"} implied, the seller loses.
                </p>
              </Panel>
            </>
          )}
        </div>
      </div>
    </TerminalShell>
  );
}
