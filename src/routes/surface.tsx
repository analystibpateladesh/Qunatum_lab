import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { TerminalShell } from "@/components/TerminalShell";
import { Panel, NumInput, fmt, fmtPct } from "@/components/ui-kit";
import { syntheticIV, blackScholes } from "@/lib/quant";

interface SurfaceGrid {
  x: number[];
  y: number[];
  z: number[][];
}

function Surface3D({ surface3d }: { surface3d: SurfaceGrid }) {
  const [Plot, setPlot] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    let active = true;
    import("react-plotly.js").then((mod) => {
      if (active) setPlot(() => mod.default);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!Plot) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading 3D engine…</div>;
  }

  return (
    <Plot
      data={[
        {
          type: "surface",
          x: surface3d.x,
          y: surface3d.y,
          z: surface3d.z,
          colorscale: [
            [0.0, "rgb(40,90,160)"],
            [0.25, "rgb(60,160,180)"],
            [0.5, "rgb(220,180,80)"],
            [0.75, "rgb(240,130,50)"],
            [1.0, "rgb(200,50,80)"],
          ],
          contours: {
            z: { show: true, usecolormap: true, highlightcolor: "#ffaa33", project: { z: true } },
          },
          colorbar: {
            title: { text: "IV %", font: { color: "#aaa", size: 10 } },
            tickfont: { color: "#aaa", size: 9 },
            thickness: 12,
            len: 0.7,
          },
          hovertemplate: "K%: %{x:.0f}<br>DTE: %{y:.0f}<br>IV: %{z:.2f}%<extra></extra>",
        } as any,
      ]}
      layout={{
        autosize: true,
        margin: { l: 0, r: 0, t: 0, b: 0 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "JetBrains Mono, monospace", color: "#ccc", size: 10 },
        scene: {
          xaxis: { title: { text: "Strike (% of spot)" }, color: "#aaa", gridcolor: "#333", backgroundcolor: "rgba(0,0,0,0)", showbackground: false },
          yaxis: { title: { text: "Days to Expiry" }, color: "#aaa", gridcolor: "#333", backgroundcolor: "rgba(0,0,0,0)", showbackground: false },
          zaxis: { title: { text: "IV (%)" }, color: "#aaa", gridcolor: "#333", backgroundcolor: "rgba(0,0,0,0)", showbackground: false },
          camera: { eye: { x: 1.6, y: -1.6, z: 0.9 } },
          aspectratio: { x: 1, y: 1.2, z: 0.8 },
        },
      } as any}
      config={{ displayModeBar: false, responsive: true } as any}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

const STRIKE_PCTS = [0.70, 0.80, 0.90, 0.95, 1.00, 1.05, 1.10, 1.20, 1.30];
const TENORS_DAYS = [7, 30, 60, 90, 180, 365, 730];

export default function SurfacePage() {
  useEffect(() => {
    document.title = "3D Volatility Surface — Quantum Lab";
  }, []);

  const [S, setS] = useState(100);
  const [atmVol, setAtmVol] = useState(22);
  const [view, setView] = useState<"3d" | "heatmap">("3d");

  const surface3d = useMemo(() => {
    const moneyness: number[] = [];
    const tenors: number[] = [];
    for (let i = 0; i <= 30; i++) moneyness.push(0.6 + (1.4 - 0.6) * (i / 30));
    for (let j = 0; j <= 25; j++) tenors.push(7 + (730 - 7) * (j / 25));
    const z: number[][] = tenors.map((d) => {
      const T = d / 365;
      return moneyness.map((m) => syntheticIV(m, T, atmVol / 100) * 100);
    });
    return { x: moneyness.map((m) => +(m * 100).toFixed(1)), y: tenors.map((d) => Math.round(d)), z };
  }, [atmVol]);

  const grid = useMemo(() => {
    return TENORS_DAYS.map((d) => {
      const T = d / 365;
      return {
        days: d,
        cells: STRIKE_PCTS.map((m) => ({
          moneyness: m,
          iv: syntheticIV(m, T, atmVol / 100),
          K: S * m,
        })),
      };
    });
  }, [S, atmVol]);

  const allIVs = grid.flatMap((r) => r.cells.map((c) => c.iv));
  const minIV = Math.min(...allIVs);
  const maxIV = Math.max(...allIVs);
  const heatColor = (iv: number) => {
    const t = (iv - minIV) / (maxIV - minIV || 1);
    const h = 215 - t * 110;
    const c = 0.13 + t * 0.10;
    const l = 0.45 + t * 0.20;
    return `oklch(${l} ${c} ${h})`;
  };

  return (
    <TerminalShell>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <Panel title="Surface Inputs" className="xl:col-span-3">
          <div className="grid grid-cols-2 gap-3">
            <NumInput label="Spot" value={S} onChange={setS} step={1} suffix="$" />
            <NumInput label="ATM σ" value={atmVol} onChange={setAtmVol} step={0.5} suffix="%" />
          </div>
          <div className="mt-4">
            <div className="stat-label mb-1">View</div>
            <div className="grid grid-cols-2 gap-1">
              {[
                { v: "3d", label: "3D Surface" },
                { v: "heatmap", label: "Heatmap" },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setView(o.v as "3d" | "heatmap")}
                  className={`text-[10px] font-bold uppercase py-1.5 rounded border ${
                    view === o.v ? "border-amber bg-amber/15 text-amber" : "border-border bg-input text-muted-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2 text-[11px] text-muted-foreground leading-relaxed pt-3 border-t border-border">
            <p><span className="text-amber">▸</span> <strong>3D mode:</strong> drag to rotate, scroll to zoom</p>
            <p><span className="text-cyan">▸</span> <strong>Smile:</strong> OTM puts richer than ATM (negative skew)</p>
            <p><span className="text-bull">▸</span> <strong>Term:</strong> short-dated vol mean-reverts faster</p>
            <p className="pt-2 border-t border-border/60">
              SVI-inspired parameterization: equity-index style negative skew + term decay.
            </p>
          </div>
        </Panel>

        <Panel
          title="Implied Volatility Surface"
          subtitle={view === "3d" ? "interactive 3D · drag to rotate" : "strike × tenor heatmap"}
          className="xl:col-span-9"
        >
          {view === "3d" ? (
            <div className="h-[480px] w-full">
              <Surface3D surface3d={surface3d} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs num">
                <thead>
                  <tr>
                    <th className="text-left p-2 stat-label">DTE \ K%</th>
                    {STRIKE_PCTS.map((m) => (
                      <th key={m} className="p-2 text-center stat-label">{(m * 100).toFixed(0)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row) => (
                    <tr key={row.days}>
                      <td className="p-2 stat-label">{row.days}d</td>
                      {row.cells.map((c) => (
                        <td key={c.moneyness} className="p-1">
                          <div
                            className="rounded-md py-2 text-center font-semibold text-background"
                            style={{ background: heatColor(c.iv) }}
                            title={`K=${c.K.toFixed(1)} IV=${(c.iv * 100).toFixed(2)}%`}
                          >
                            {(c.iv * 100).toFixed(1)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>min <span className="text-cyan num">{fmtPct(minIV)}</span></span>
            <span>max <span className="text-amber num">{fmtPct(maxIV)}</span></span>
            <span>range <span className="num">{fmtPct(maxIV - minIV)}</span></span>
          </div>
        </Panel>

        <Panel title="Volatility Smile" subtitle="90-day slice" className="xl:col-span-6">
          <SmileChart S={S} atmVol={atmVol / 100} days={90} />
        </Panel>
        <Panel title="ATM Term Structure" subtitle="moneyness = 100%" className="xl:col-span-6">
          <TermChart atmVol={atmVol / 100} />
        </Panel>

        <Panel title="Live Chain (priced from surface)" subtitle="Black-Scholes @ surface IV" className="xl:col-span-12">
          <div className="overflow-x-auto">
            <table className="w-full text-xs num">
              <thead className="border-b border-border">
                <tr className="text-muted-foreground">
                  {["Strike", "Moneyness", "30d Call", "30d Put", "90d Call", "90d Put", "Surface IV (90d)"].map((h) => (
                    <th key={h} className="text-right p-2 stat-label">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STRIKE_PCTS.map((m) => {
                  const K = S * m;
                  const ivShort = syntheticIV(m, 30 / 365, atmVol / 100);
                  const ivLong = syntheticIV(m, 90 / 365, atmVol / 100);
                  const cs = blackScholes({ S, K, T: 30 / 365, r: 0.045, q: 0.015, sigma: ivShort, type: "call" });
                  const ps = blackScholes({ S, K, T: 30 / 365, r: 0.045, q: 0.015, sigma: ivShort, type: "put" });
                  const cl = blackScholes({ S, K, T: 90 / 365, r: 0.045, q: 0.015, sigma: ivLong, type: "call" });
                  const pl = blackScholes({ S, K, T: 90 / 365, r: 0.045, q: 0.015, sigma: ivLong, type: "put" });
                  return (
                    <tr key={m} className="border-b border-border/40 hover:bg-panel-elevated/50">
                      <td className="text-right p-2 text-amber font-semibold">${K.toFixed(2)}</td>
                      <td className="text-right p-2 text-muted-foreground">{(m * 100).toFixed(0)}%</td>
                      <td className="text-right p-2">{fmt(cs, 3)}</td>
                      <td className="text-right p-2">{fmt(ps, 3)}</td>
                      <td className="text-right p-2 text-cyan">{fmt(cl, 3)}</td>
                      <td className="text-right p-2 text-cyan">{fmt(pl, 3)}</td>
                      <td className="text-right p-2">{fmtPct(ivLong)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </TerminalShell>
  );
}

function SmileChart({ S, atmVol, days }: { S: number; atmVol: number; days: number }) {
  const data = useMemo(() => {
    const T = days / 365;
    const arr = [];
    for (let i = 0; i <= 50; i++) {
      const m = 0.6 + (1.4 - 0.6) * (i / 50);
      arr.push({ K: +(S * m).toFixed(2), iv: +(syntheticIV(m, T, atmVol) * 100).toFixed(3) });
    }
    return arr;
  }, [S, atmVol, days]);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="smile" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.78 0.13 215)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="oklch(0.78 0.13 215)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
          <XAxis dataKey="K" stroke="oklch(0.68 0.02 250)" fontSize={10} />
          <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} unit="%" />
          <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
          <ReferenceLine x={S} stroke="oklch(0.78 0.16 75)" strokeDasharray="3 3" label={{ value: "ATM", fill: "oklch(0.78 0.16 75)", fontSize: 10 }} />
          <Area type="monotone" dataKey="iv" stroke="oklch(0.78 0.13 215)" fill="url(#smile)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TermChart({ atmVol }: { atmVol: number }) {
  const data = useMemo(() => {
    const arr = [];
    for (let d = 7; d <= 730; d += 14) {
      arr.push({ days: d, iv: +(syntheticIV(1.0, d / 365, atmVol) * 100).toFixed(3) });
    }
    return arr;
  }, [atmVol]);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="oklch(0.30 0.025 250 / 0.5)" strokeDasharray="2 4" />
          <XAxis dataKey="days" stroke="oklch(0.68 0.02 250)" fontSize={10} />
          <YAxis stroke="oklch(0.68 0.02 250)" fontSize={10} unit="%" />
          <Tooltip contentStyle={{ background: "oklch(0.20 0.020 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
          <Line type="monotone" dataKey="iv" stroke="oklch(0.78 0.16 75)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
