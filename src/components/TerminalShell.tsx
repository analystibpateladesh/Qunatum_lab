import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Pricer", code: "PRC" },
  { to: "/surface", label: "Vol Surface", code: "SRF" },
  { to: "/sensitivity", label: "Greeks Lab", code: "GRK" },
  { to: "/strategies", label: "Strategies", code: "STR" },
  { to: "/var", label: "Portfolio VaR", code: "VAR" },
  { to: "/hedging", label: "Δ-Hedge BT", code: "HBT" },
  { to: "/market", label: "Market Data", code: "MKT" },
];

function Clock() {
  const [t, setT] = useState<string>("--:--:--");
  useEffect(() => {
    const tick = () => setT(new Date().toUTCString().slice(17, 25));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="num text-[11px] text-muted-foreground tabular">{t} UTC</span>;
}

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="ticker-strip">
        <div className="flex items-center justify-between px-4 py-1.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-bull pulse-dot" />
              <span className="text-[10px] font-bold tracking-[0.18em] text-amber">QUANTUM·LAB</span>
              <span className="text-[10px] text-muted-foreground tracking-widest">v1.0</span>
            </div>
            <span className="text-muted-foreground/40">│</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Derivatives Pricing & Risk Engine
            </span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="hidden sm:inline">SESSION: <span className="text-cyan num">LIVE</span></span>
            <span className="hidden sm:inline">LATENCY: <span className="text-bull num">0.4ms</span></span>
            <Clock />
          </div>
        </div>
      </header>

      <nav className="border-b border-border bg-panel">
        <div className="flex overflow-x-auto">
          {NAV.map((n) => {
            const active = pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "relative px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors whitespace-nowrap flex items-center gap-2",
                  active ? "text-amber" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="num text-[9px] opacity-50">{n.code}</span>
                <span>{n.label}</span>
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 bg-amber glow-amber" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="flex-1 px-3 py-3 sm:px-4 sm:py-4">{children}</main>

      <footer className="border-t border-border bg-panel px-4 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>BLACK-SCHOLES · BINOMIAL · MONTE-CARLO · GREEKS</span>
        <span className="hidden sm:inline">© Quantum Derivatives Lab — for research & education</span>
      </footer>
    </div>
  );
}
