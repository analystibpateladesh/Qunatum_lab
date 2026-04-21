import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, LineChart, Line,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, Stat, NumInput, fmtPct } from "@/components/ui-kit";
import { fetchBatchPrices, type PricesResponse } from "@/lib/twelvedata";
import { logReturns, mean, stdev, quantile, normInv, gauss } from "@/lib/stats";

interface Holding {
  symbol: string;
  weight: number;
}

const DEFAULT: Holding[] = [
  { symbol: "SPY", weight: 0.4 },
  { symbol: "QQQ", weight: 0.25 },
  { symbol: "AAPL", weight: 0.15 },
  { symbol: "NVDA", weight: 0.1 },
  { symbol: "TLT", weight: 0.1 },
];

const STRESS = [
  { name: "GFC 2008", date: "2008-10-15", note: "Lehman aftermath" },
  { name: "COVID Crash", date: "2020-03-16", note: "Pandemic shock" },
  { name: "Vol-mageddon", date: "2018-02-05", note: "VIX spike" },
  { name: "Aug 2011 S&P Cut", date: "2011-08-08", note: "US debt downgrade" },
  { name: "Brexit", date: "2016-06-24", note: "UK referendum" },
  { name: "2022 Rate Shock", date: "2022-06-13", note: "CPI surprise" },
];

export default function VarPage() {
  useEffect(() => {
    document.title = "Portfolio VaR — Quantum Lab";
  }, []);
  const [holdings, setHoldings] = useState<Holding[]>(DEFAULT);
  const [portfolioValue, setPortfolioValue] = useState(1_000_000);
  const [confidence, setConfidence] = useState(99);
  const [horizon, setHorizon] = useState(1);
  const [windowDays, setWindowDays] = useState(504);
  const [mcPaths, setMcPaths] = useState(20_000);
  const [series, setSeries] = useState<PricesResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const symbolsKey = useMemo(
    () => holdings.map((h) => h.symbol.trim().toUpperCase()).join("|"),
    [holdings],
  );

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetchBatchPrices(holdings.map((h) => h.symbol));
        if (!active) return;

        if (res.errors.length > 0) {
          setSeries(null);
          setLoadError(res.errors.map((e) => `${e.symbol}: ${e.message}`).join(" · "));
          return;
        }

        setSeries(res.series);
      } catch (error) {
        if (!active) return;
        setSeries(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [symbolsKey, holdings]);

  const allLoaded = !!series && !loading;
  const anyError = loadError;

  const analysis = useMemo(() => {
    if (!allLoaded || !series) return null;

    const seriesByDate: Map<string, number[]> = new Map();
    series.forEach((priceSeries, i) => {
      const bars = priceSeries.bars.slice(-windowDays - 1);
      bars.forEach((bar) => {
        if (!seriesByDate.has(bar.date)) {
          seriesByDate.set(bar.date, Array.from({ length: holdings.length }, () => Number.NaN));
        }
        seriesByDate.get(bar.date)![i] = bar.close;
      });
    });

    const aligned = [...seriesByDate.entries()]
      .filter(([_, arr]) => arr.every((v) => Number.isFinite(v)))
      .sort(([a], [b]) => a.localeCompare(b));

    if (aligned.length < 30) return null;

    const closes = holdings.map((_, i) => aligned.map(([, arr]) => arr[i]));
    const rets = closes.map((c) => logReturns(c));
    const dates = aligned.slice(1).map(([d]) => d);

    const totalW = holdings.reduce((sum, h) => sum + h.weight, 0) || 1;
    const weights = holdings.map((h) => h.weight / totalW);
    const portRets: number[] = [];
    for (let t = 0; t < dates.length; t++) {
      let r = 0;
      for (let i = 0; i < holdings.length; i++) r += weights[i] * rets[i][t];
      portRets.push(r);
    }

    const hSqrt = Math.sqrt(horizon);
    const alpha = 1 - confidence / 100;

    const scaledHist = portRets.map((r) => r * hSqrt);
    const historicalVaR = -quantile(scaledHist, alpha);
    const tail = scaledHist.filter((r) => r <= -historicalVaR);
    const historicalES = tail.length ? -mean(tail) : historicalVaR;

    const mu = mean(portRets);
    const sd = stdev(portRets);
    const z = -normInv(alpha);
    const parametricVaR = (z * sd - mu) * hSqrt;
    const parametricES = (sd * Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * alpha) - mu) * hSqrt;

    const muVec = rets.map((r) => mean(r));
    const n = holdings.length;
    const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const sampleSize = rets[0].length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let acc = 0;
        for (let t = 0; t < sampleSize; t++) {
          acc += (rets[i][t] - muVec[i]) * (rets[j][t] - muVec[j]);
        }
        cov[i][j] = acc / (sampleSize - 1);
      }
    }

    const chol: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = cov[i][j];
        for (let k = 0; k < j; k++) s -= chol[i][k] * chol[j][k];
        if (i === j) chol[i][j] = Math.sqrt(Math.max(s, 1e-12));
        else chol[i][j] = s / chol[j][j];
      }
    }

    const mcRets: number[] = [];
    for (let p = 0; p < mcPaths; p++) {
      const shocks = Array.from({ length: n }, gauss);
      let portR = 0;
      for (let i = 0; i < n; i++) {
        let rI = muVec[i];
        for (let j = 0; j <= i; j++) rI += chol[i][j] * shocks[j];
        portR += weights[i] * rI;
      }
      mcRets.push(portR * hSqrt);
    }

    const mcVaR = -quantile(mcRets, alpha);
    const mcTail = mcRets.filter((r) => r <= -mcVaR);
    const mcES = mcTail.length ? -mean(mcTail) : mcVaR;

    const bins = 40;
    const lo = Math.min(...scaledHist);
    const hi = Math.max(...scaledHist);
    const binWidth = (hi - lo) / bins || 1;
    const hist = Array.from({ length: bins }, (_, i) => {
      const a = lo + i * binWidth;
      const b = a + binWidth;
      const count = scaledHist.filter((r) => r >= a && (i === bins - 1 ? r <= b : r < b)).length;
      const mid = (a + b) / 2;
      return { bucket: (mid * 100).toFixed(2), count, mid: +(mid * 100).toFixed(3) };
    });

    const stressResults = STRESS.map((s) => {
      const idx = dates.findIndex((d) => d >= s.date);
      const ret = idx >= 0 ? portRets[idx] : null;
      return { ...s, ret };
    });

    const sigmaP = Math.sqrt(
      weights.reduce(
        (acc, wi, i) => acc + weights.reduce((inner, wj, j) => inner + wi * wj * cov[i][j], 0),
        0,
      ),
    );

    const marginalVaR = weights.map((wi, i) => {
      const beta = weights.reduce((acc, wj, j) => acc + wj * cov[i][j], 0) / (sigmaP * sigmaP || 1);
      return { symbol: holdings[i].symbol, weight: wi, contribution: wi * beta };
    });

    return {
      portRets,
      dates,
      historicalVaR,
      historicalES,
      parametricVaR,
      parametricES,
      mcVaR,
      mcES,
      hist,
      stressResults,
      marginalVaR,
      sigmaP,
      varLine: -historicalVaR * 100,
    };
  }, [allLoaded, series, holdings, windowDays, horizon, confidence, mcPaths]);

  const updateHolding = (i: number, key: keyof Holding, val: string) => {
    const next = [...holdings];
    if (key === "weight") next[i].weight = parseFloat(val) / 100 || 0;
    else next[i].symbol = val.toUpperCase();
    setHoldings(next);
  };

  const addHolding = () => setHoldings([...holdings, { symbol: "GLD", weight: 0.05 }]);
  const removeHolding = (i: number) => setHoldings(holdings.filter((_, k) => k !== i));
  const wSum = holdings.reduce((sum, h) => sum + h.weight, 0);

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel title="Portfolio" subtitle="weights normalized" className="xl:col-span-4">
          <div className="space-y-1.5 mb-3">
            {holdings.map((h, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <input
                  value={h.symbol}
                  onChange={(e) => updateHolding(i, "symbol", e.target.value)}
                  className="num bg-input border border-border rounded px-2 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-amber"
                />
                <input
                  type="number"
                  value={(h.weight * 100).toFixed(1)}
                  step={1}
                  onChange={(e) => updateHolding(i, "weight", e.target.value)}
                  className="num bg-input border border-border rounded px-2 py-1 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-amber"
                />
                <span className="text-[10px] text-muted-foreground">%</span>
                <button onClick={() => removeHolding(i)} className="text-bear text-xs px-1.5">×</button>
              </div>
            ))}
            <button onClick={addHolding} className="w-full text-[10px] uppercase font-semibold py-1 rounded border border-dashed border-border text-muted-foreground hover:text-amber hover:border-amber">
              + Add Holding
            </button>
            <div className="text-[10px] text-muted-foreground text-right num">
              Σ weight = {(wSum * 100).toFixed(1)}%
            </div>
          </div>

          <div className="pt-3 border-t border-border grid grid-cols-2 gap-2">
            <NumInput label="NAV" value={portfolioValue} onChange={setPortfolioValue} step={10000} suffix="$" />
            <NumInput label="Conf" value={confidence} onChange={setConfidence} step={0.5} min={50} max={99.9} suffix="%" />
            <NumInput label="Horizon" value={horizon} onChange={setHorizon} step={1} min={1} max={20} suffix="days" />
            <NumInput label="MC Paths" value={mcPaths} onChange={setMcPaths} step={5000} min={1000} suffix="" />
            <NumInput label="Lookback" value={windowDays} onChange={setWindowDays} step={50} min={60} max={2000} suffix="days" />
          </div>
        </Panel>

        <div className="xl:col-span-8 grid gap-3">
          {!allLoaded && !anyError && (
            <Panel title="Loading">
              <div className="text-sm text-muted-foreground">Fetching market data for portfolio…</div>
            </Panel>
          )}

          {anyError && (
            <Panel title="Data Error">
              <div className="text-sm text-bear">{anyError}</div>
            </Panel>
          )}

          {analysis && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Stat
                  label={`Historical VaR ${confidence}%`}
                  value={fmtPct(analysis.historicalVaR)}
                  accent="bear"
                  hint={`= $${(analysis.historicalVaR * portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
                <Stat
                  label="Parametric VaR"
                  value={fmtPct(analysis.parametricVaR)}
                  accent="bear"
                  hint={`normal, σ-scaled · $${(analysis.parametricVaR * portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
                <Stat
                  label="Monte Carlo VaR"
                  value={fmtPct(analysis.mcVaR)}
                  accent="bear"
                  hint={`${(mcPaths / 1000).toFixed(0)}k paths · $${(analysis.mcVaR * portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
                <Stat label="Historical ES (CVaR)" value={fmtPct(analysis.historicalES)} accent="bear" hint="conditional VaR · expected tail loss" />
                <Stat label="Parametric ES" value={fmtPct(analysis.parametricES)} accent="bear" hint="closed-form normal" />
                <Stat label="Monte Carlo ES" value={fmtPct(analysis.mcES)} accent="bear" hint="empirical tail mean" />
              </div>

              <Panel title="Portfolio Return Distribution" subtitle={`historical · 1d returns scaled to ${horizon}d horizon`}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analysis.hist} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                      <XAxis dataKey="bucket" stroke="oklch(0.68 0.02 250)" fontSize={9} interval={3} />
                      <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                      <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                      <ReferenceLine x={analysis.varLine.toFixed(2)} stroke="oklch(0.65 0.24 25)" strokeWidth={2} strokeDasharray="3 3" label={{ value: `VaR ${confidence}%`, fill: "oklch(0.65 0.24 25)", fontSize: 10, position: "top" }} />
                      <Bar dataKey="count">
                        {analysis.hist.map((b, i) => (
                          <rect key={i} fill={b.mid <= analysis.varLine ? "oklch(0.65 0.24 25)" : "oklch(0.78 0.16 75)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Red bars = realized losses worse than {confidence}% VaR threshold (the empirical tail).
                  ES averages those red bars — the expected loss <em>given</em> we breach VaR.
                </p>
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Panel title="Stress Tests" subtitle="historical scenario P&amp;L">
                  <div className="space-y-1.5">
                    {analysis.stressResults.map((s) => (
                      <div key={s.name} className="flex items-center justify-between p-2 rounded border border-border/60 bg-background/40">
                        <div>
                          <div className="text-xs font-semibold">{s.name}</div>
                          <div className="text-[10px] text-muted-foreground num">{s.date} · {s.note}</div>
                        </div>
                        <div className="text-right">
                          {s.ret === null ? (
                            <span className="text-[10px] text-muted-foreground">no data</span>
                          ) : (
                            <>
                              <div className={`stat-value text-sm ${s.ret < 0 ? "text-bear" : "text-bull"}`}>
                                {fmtPct(s.ret)}
                              </div>
                              <div className="text-[10px] num text-muted-foreground">
                                ${(s.ret * portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel title="Risk Contribution" subtitle="component VaR by holding">
                  <div className="space-y-1.5">
                    {analysis.marginalVaR.map((m) => {
                      const pct = m.contribution / (analysis.marginalVaR.reduce((sum, x) => sum + Math.abs(x.contribution), 0) || 1);
                      return (
                        <div key={m.symbol} className="space-y-0.5">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-amber">{m.symbol}</span>
                            <span className="num">{fmtPct((m.contribution / (analysis.sigmaP || 1)) * analysis.historicalVaR)}</span>
                          </div>
                          <div className="h-2 bg-input rounded overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-amber to-bear" style={{ width: `${Math.min(100, Math.abs(pct) * 100)}%` }} />
                          </div>
                          <div className="text-[10px] text-muted-foreground num flex justify-between">
                            <span>weight {(m.weight * 100).toFixed(1)}%</span>
                            <span>{(pct * 100).toFixed(1)}% of risk</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              </div>

              <Panel title="Daily Portfolio Returns" subtitle="time series">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analysis.dates.map((d, i) => ({ d, r: +(analysis.portRets[i] * 100).toFixed(3) }))} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                      <XAxis dataKey="d" stroke="oklch(0.68 0.02 250)" fontSize={9} minTickGap={64} />
                      <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} unit="%" />
                      <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                      <ReferenceLine y={-analysis.historicalVaR * 100} stroke="oklch(0.65 0.24 25)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="r" stroke="oklch(0.78 0.13 215)" strokeWidth={1} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </TerminalShell>
  );
}
