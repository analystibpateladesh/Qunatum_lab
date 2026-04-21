import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title, subtitle, children, className, action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      <header className="panel-header justify-between">
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {subtitle && (
            <span className="normal-case tracking-normal text-[10px] text-muted-foreground/70">
              · {subtitle}
            </span>
          )}
        </div>
        {action}
      </header>
      <div className="p-3 sm:p-4 flex-1">{children}</div>
    </section>
  );
}

export function Stat({
  label, value, hint, accent = "default", mono = true,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: "default" | "bull" | "bear" | "amber" | "cyan";
  mono?: boolean;
}) {
  const color = {
    default: "text-foreground",
    bull: "text-bull",
    bear: "text-bear",
    amber: "text-amber",
    cyan: "text-cyan",
  }[accent];
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 border border-border/60 rounded-md bg-background/40">
      <span className="stat-label">{label}</span>
      <span className={cn("text-base sm:text-lg leading-tight", mono && "stat-value", color)}>
        {value}
      </span>
      {hint && <span className="text-[10px] text-muted-foreground num">{hint}</span>}
    </div>
  );
}

export function NumInput({
  label, value, onChange, step = 1, min, max, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="stat-label flex items-center justify-between">
        <span>{label}</span>
        {suffix && <span className="text-muted-foreground/60">{suffix}</span>}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="num bg-input border border-border rounded-md px-2.5 py-1.5 text-sm
                   focus:outline-none focus:ring-2 focus:ring-amber focus:border-amber
                   transition-colors text-foreground"
      />
    </label>
  );
}

export function Toggle({
  options, value, onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-input p-0.5 border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition-all",
            value === o.value
              ? "bg-amber text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return n.toExponential(2);
  return n.toFixed(digits);
}

export function fmtPct(n: number, digits = 2): string {
  return `${(n * 100).toFixed(digits)}%`;
}
