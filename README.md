# Quantum Lab — Multi-Model Options Pricer & Risk Workbench

A browser-based quant research terminal for pricing options, exploring volatility surfaces, stress-testing portfolios, and analysing live market data. Built with **React 19**, **TanStack Start**, **Tailwind v4**, **Recharts**, and **Twelve Data** for live prices.

> Black–Scholes • Binomial (EU/US) • Monte Carlo • Greeks • Implied Vol • VaR • Hedging • Strategy Builder • IV Surface

---

## ✨ Features

| Route | Description |
|-------|-------------|
| `/`            | **Pricer** — Black–Scholes, Binomial (European & American), Monte Carlo, full Greeks, implied-vol solver, payoff & term-structure charts |
| `/sensitivity` | **Greeks Lab** — interactive Δ, Γ, Vega, Θ, ρ surfaces vs spot/time/vol |
| `/strategies`  | **Strategy Builder** — build multi-leg structures (spreads, straddles, condors, butterflies) with combined payoff & Greeks |
| `/surface`     | **IV Surface** — 3D implied-volatility surface across strikes & maturities |
| `/var`         | **Value-at-Risk** — historical & parametric VaR/ES on live equities, ETFs, FX & crypto |
| `/hedging`     | **Delta Hedging** — simulate discrete re-hedging P&L with transaction costs |
| `/market`      | **Market Monitor** — live quotes & historical charts via Twelve Data |

---

## 🚀 Quick Start

```bash
# 1. Install
bun install        # or npm install / pnpm install

# 2. Set your Twelve Data API key (free: https://twelvedata.com/register)
echo "VITE_TWELVEDATA_API_KEY=your_key_here" > .env

# 3. Run
bun run dev        # http://localhost:5173
```

A demo key is hardcoded as a fallback so the app works out-of-the-box, but you should set your own for production (free tier: 800 req/day, 8 req/min).

---

## 🧮 Pricing Models

All pricers are pure TypeScript — no backend required.

- **Black–Scholes–Merton** — closed-form European options with continuous dividends
- **Cox–Ross–Rubinstein Binomial Tree** — 250-step, supports early exercise (American)
- **Monte Carlo** — 30k antithetic-variate paths, GBM under risk-neutral measure
- **Greeks** — analytical Δ, Γ, Vega, Θ, ρ
- **Implied Volatility** — Brent-style root finder on the BS surface

See [`src/lib/quant.ts`](src/lib/quant.ts) and [`src/lib/stats.ts`](src/lib/stats.ts).

---

## 📊 Live Market Data

Powered by **[Twelve Data](https://twelvedata.com)** — one API for stocks, ETFs, FX, and crypto, with proper CORS for direct browser calls.

| Asset class | Ticker examples |
|-------------|-----------------|
| Equities    | `AAPL`, `MSFT`, `NVDA` |
| ETFs        | `SPY`, `QQQ`, `IWM` |
| Crypto      | `BTC`, `ETH`, `BTCUSD` |
| FX          | `EURUSD`, `GBPUSD`, `USDJPY` |

Symbols are auto-resolved (e.g. `BTCUSD` → `BTC/USD`). Responses are cached for 30s and auto-refreshed when the tab is focused.

---

## 🛠 Tech Stack

- **Framework:** TanStack Start v1 (React 19 + Vite 7)
- **Routing:** File-based via `src/routes/`
- **Styling:** Tailwind CSS v4 with semantic OKLCH design tokens
- **Charts:** Recharts (2D) + Plotly (3D surface)
- **UI:** shadcn/ui + Radix primitives
- **Data:** Twelve Data REST API

---

## 📁 Project Structure

```
src/
├── routes/              # File-based pages (/, /var, /surface, ...)
├── components/
│   ├── ui/              # shadcn primitives
│   ├── ui-kit.tsx       # Panel, Stat, NumInput, Toggle
│   └── TerminalShell.tsx
├── lib/
│   ├── quant.ts         # Pricing models & Greeks
│   ├── stats.ts         # Statistical utilities
│   └── twelvedata.ts    # Market-data client
├── hooks/
│   └── usePrices.ts     # React hook with caching & auto-refresh
└── styles.css           # Tailwind v4 + design tokens
```

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_TWELVEDATA_API_KEY` | Recommended | Your Twelve Data API key. Falls back to a shared demo key if absent. |

On **Netlify**: Site settings → Environment variables → add `VITE_TWELVEDATA_API_KEY`.
---
## 📜 Scripts

```bash
bun run dev         # Start dev server
bun run build       # Production build
bun run preview     # Preview production build
bun run lint        # ESLint
bun run format      # Prettier
```
## ⚠️ Disclaimer
This project is for **educational and research purposes only**. Pricing models, risk metrics, and market data are provided as-is with no warranty. Do not use as the sole basis for trading decisions.
---
## 📄 License
MIT
