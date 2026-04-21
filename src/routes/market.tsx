import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, Stat, fmt, fmtPct } from "@/components/ui-kit";
import { usePrices } from "@/hooks/usePrices";
import { logReturns, mean, stdev, skewness, kurtosis, ann, annRet, TRADING_DAYS } from "@/lib/stats";

const PRESETS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "GOOG", "META", "BTCUSD", "ETHUSD"];

export default function MarketPage() {
  useEffect(() => {
    document.title = "Market Data — Quantum Lab";
  }, []);

  const [input, setInput] = useState("SPY");
  const [symbol, setSymbol] = useState("SPY");
  const [windowDays, setWindowDays] = useState(252 * 2);

  const { data, loading, error, refetch } = usePrices(symbol);

  const sliced = useMemo(() => {
    if (!data) return null;
    const bars = data.bars.slice(-windowDays);
    const closes = bars.map((b) => b.close);
    const rets = logReturns(closes);
    const dailyMean = mean(rets);
    const dailySd = stdev(rets);
    const sk = skewness(rets);
    const ku = kurtosis(rets);
    const annVol = ann(dailySd);
    const annReturn = annRet(dailyMean);
    // Sharpe (rf=0 for simplicity)
    const sharpe = dailySd > 0 ? annReturn / annVol : 0;

    // Rolling 21d vol
    const roll: { date: string; vol: number; price: number; ret: number }[] = [];
    for (let i = 21; i < bars.length; i++) {
      const win = rets.slice(i - 21, i);
      const v = stdev(win) * Math.sqrt(TRADING_DAYS) * 100;
      roll.push({
        date: bars[i].date,
        vol: +v.toFixed(3),
        price: +bars[i].close.toFixed(2),
        ret: i > 0 ? +((rets[i - 1] || 0) * 100).toFixed(3) : 0,
      });
    }

    // Returns histogram
    const bins = 30;
    const lo = Math.min(...rets), hi = Math.max(...rets);
    const w = (hi - lo) / bins || 1;
    const hist: { bucket: string; count: number; mid: number }[] = [];
    for (let i = 0; i < bins; i++) {
      const a = lo + i * w;
      const b = a + w;
      const c = rets.filter((r) => r >= a && (i === bins - 1 ? r <= b : r < b)).length;
      const mid = (a + b) / 2;
      hist.push({ bucket: (mid * 100).toFixed(2), count: c, mid: +(mid * 100).toFixed(3) });
    }

    // Drawdowns
    let peak = closes[0], maxDD = 0;
    const dd: { date: string; dd: number }[] = [];
    for (let i = 0; i < bars.length; i++) {
      if (closes[i] > peak) peak = closes[i];
      const cur = (closes[i] / peak - 1) * 100;
      if (cur < maxDD) maxDD = cur;
      dd.push({ date: bars[i].date, dd: +cur.toFixed(3) });
    }

    return {
      bars,
      closes,
      rets,
      dailyMean,
      dailySd,
      annVol,
      annReturn,
      sharpe,
      sk,
      ku,
      roll,
      hist,
      dd,
      maxDD,
      first: bars[0],
      last: bars[bars.length - 1],
      totalReturn: closes[closes.length - 1] / closes[0] - 1,
    };
  }, [data, windowDays]);

  const submit = () => setSymbol(input.trim().toUpperCase() || "SPY");

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel title="Symbol" subtitle="EOD via Stooq" className="xl:col-span-3">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="num bg-input border border-border rounded-md px-2.5 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-amber"
              placeholder="SPY"
            />
            <button
              onClick={submit}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded bg-amber text-primary-foreground hover:opacity-90"
            >
              Load
            </button>
          </div>
          <div className="mt-3 stat-label">Quick Picks</div>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {PRESETS.map((s) => (
              <button
                key={s}
                onClick={() => { setInput(s); setSymbol(s); }}
                className={`text-[10px] font-semibold py-1 rounded border transition-all ${
                  symbol === s
                    ? "border-amber bg-amber/15 text-amber"
                    : "border-border bg-input text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <div className="stat-label mb-1">Lookback</div>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: "3M", v: 63 },
                { label: "6M", v: 126 },
                { label: "1Y", v: 252 },
                { label: "2Y", v: 504 },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setWindowDays(o.v)}
                  className={`text-[10px] font-semibold py-1 rounded border ${
                    windowDays === o.v ? "border-cyan bg-cyan/15 text-cyan" : "border-border bg-input text-muted-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground leading-relaxed">
            <p><span className="text-amber">▸</span> Equity: <span className="num">AAPL, SPY</span></p>
            <p><span className="text-cyan">▸</span> Crypto: <span className="num">BTCUSD, ETHUSD</span></p>
            <p><span className="text-bull">▸</span> FX: <span className="num">EURUSD, GBPUSD</span></p>
          </div>
        </Panel>

        <div className="xl:col-span-9 grid gap-3">
          {loading && (
            <Panel title="Loading"><div className="text-sm text-muted-foreground">Fetching {symbol}…</div></Panel>
          )}
          {error && (
            <Panel title="Error" subtitle={symbol}>
              <div className="text-sm text-bear">{error}</div>
              <button onClick={refetch} className="mt-2 text-xs px-3 py-1.5 rounded bg-amber text-primary-foreground">Retry</button>
            </Panel>
          )}

          {sliced && !loading && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                <Stat label="Last" value={`$${fmt(sliced.last.close, 2)}`} accent="amber" hint={sliced.last.date} />
                <Stat label="Total Ret" value={fmtPct(sliced.totalReturn)} accent={sliced.totalReturn >= 0 ? "bull" : "bear"} />
                <Stat label="Ann. Vol σ" value={fmtPct(sliced.annVol)} accent="cyan" />
                <Stat label="Ann. Return" value={fmtPct(sliced.annReturn)} accent={sliced.annReturn >= 0 ? "bull" : "bear"} />
                <Stat label="Sharpe" value={fmt(sliced.sharpe, 3)} accent={sliced.sharpe > 0 ? "bull" : "bear"} hint="rf=0" />
                <Stat label="Max DD" value={fmtPct(sliced.maxDD / 100)} accent="bear" />
                <Stat label="Skew" value={fmt(sliced.sk, 3)} accent={sliced.sk < 0 ? "bear" : "bull"} hint="3rd moment" />
                <Stat label="Kurtosis" value={fmt(sliced.ku, 3)} accent="amber" hint="excess (4th)" />
                <Stat label="Bars" value={sliced.bars.length} hint="trading days" />
                <Stat label="μ daily" value={fmtPct(sliced.dailyMean)} hint="log-return" />
                <Stat label="σ daily" value={fmtPct(sliced.dailySd)} hint="log-return" />
                <Stat label="VaR 95%" value={fmtPct(-1.645 * sliced.dailySd)} accent="bear" hint="parametric 1d" />
              </div>

              <Panel title={`${symbol} — Price`} subtitle="EOD close">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sliced.roll} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.78 0.16 75)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="oklch(0.78 0.16 75)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                      <XAxis dataKey="date" stroke="oklch(0.68 0.02 250)" fontSize={9} minTickGap={48} />
                      <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                      <Area type="monotone" dataKey="price" stroke="oklch(0.78 0.16 75)" fill="url(#px)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Panel title="Rolling 21-day Volatility" subtitle="annualized %">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sliced.roll} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                        <XAxis dataKey="date" stroke="oklch(0.68 0.02 250)" fontSize={9} minTickGap={48} />
                        <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} unit="%" />
                        <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                        <Line type="monotone" dataKey="vol" stroke="oklch(0.78 0.13 215)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                <Panel title="Returns Distribution" subtitle="daily log-returns (%)">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sliced.hist} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                        <XAxis dataKey="bucket" stroke="oklch(0.68 0.02 250)" fontSize={9} interval={2} />
                        <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} />
                        <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                        <Bar dataKey="count" fill="oklch(0.78 0.16 75)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </div>

              <Panel title="Drawdown" subtitle="from rolling peak (%)">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sliced.dd} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dd" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.65 0.24 25)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="oklch(0.65 0.24 25)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
                      <XAxis dataKey="date" stroke="oklch(0.68 0.02 250)" fontSize={9} minTickGap={48} />
                      <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} unit="%" />
                      <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                      <Area type="monotone" dataKey="dd" stroke="oklch(0.65 0.24 25)" fill="url(#dd)" strokeWidth={1.5} />
                    </AreaChart>
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
