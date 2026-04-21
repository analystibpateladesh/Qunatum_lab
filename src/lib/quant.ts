/**
 * Quantitative Derivatives Math Engine
 * ────────────────────────────────────────────────────────────
 * Pure TypeScript implementation of:
 *   • Black-Scholes-Merton closed-form pricer (European calls/puts)
 *   • Cox-Ross-Rubinstein binomial tree (American + European)
 *   • Monte Carlo simulation with antithetic variates
 *   • Greeks: Δ Γ Vega Θ Ρ + 2nd-order (Vanna, Volga, Charm)
 *   • Implied volatility via Brent's method
 *
 * All formulas verified against Hull "Options, Futures and Other Derivatives" 10e.
 */

export type OptionType = "call" | "put";

export interface OptionParams {
  S: number;       // spot price
  K: number;       // strike
  T: number;       // time to expiry in years
  r: number;       // risk-free rate (annual, cont. compound)
  q: number;       // continuous dividend yield
  sigma: number;   // volatility (annual)
  type: OptionType;
}

/* ──────────────────────────────────────────────────────────
 * Standard normal CDF (Abramowitz & Stegun 7.1.26 – ε < 1.5e-7)
 * ────────────────────────────────────────────────────────── */
export function normCdf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/* ──────────────────────────────────────────────────────────
 * Black-Scholes-Merton (with continuous dividend yield q)
 * ────────────────────────────────────────────────────────── */
function d1d2({ S, K, T, r, q, sigma }: OptionParams) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2, sqrtT };
}

export function blackScholes(p: OptionParams): number {
  if (p.T <= 0) return Math.max(0, p.type === "call" ? p.S - p.K : p.K - p.S);
  const { d1, d2 } = d1d2(p);
  const dfR = Math.exp(-p.r * p.T);
  const dfQ = Math.exp(-p.q * p.T);
  if (p.type === "call") return p.S * dfQ * normCdf(d1) - p.K * dfR * normCdf(d2);
  return p.K * dfR * normCdf(-d2) - p.S * dfQ * normCdf(-d1);
}

/* ──────────────────────────────────────────────────────────
 * Greeks (closed-form). Per 1.0 underlying / 1% vol / 1 day / 1% rate.
 * ────────────────────────────────────────────────────────── */
export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;     // per 1% vol move
  theta: number;    // per calendar day
  rho: number;      // per 1% rate move
  vanna: number;    // ∂Δ/∂σ
  volga: number;    // ∂Vega/∂σ
  charm: number;    // ∂Δ/∂t  (per day)
}

export function greeks(p: OptionParams): Greeks {
  if (p.T <= 0) {
    return { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0, vanna: 0, volga: 0, charm: 0 };
  }
  const { d1, d2, sqrtT } = d1d2(p);
  const dfR = Math.exp(-p.r * p.T);
  const dfQ = Math.exp(-p.q * p.T);
  const nd1 = normPdf(d1);

  const isCall = p.type === "call";
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);

  const delta = isCall ? dfQ * Nd1 : dfQ * (Nd1 - 1);
  const gamma = (dfQ * nd1) / (p.S * p.sigma * sqrtT);
  const vega  = (p.S * dfQ * nd1 * sqrtT) / 100;

  const thetaAnnual = isCall
    ? -(p.S * dfQ * nd1 * p.sigma) / (2 * sqrtT)
      - p.r * p.K * dfR * Nd2
      + p.q * p.S * dfQ * Nd1
    : -(p.S * dfQ * nd1 * p.sigma) / (2 * sqrtT)
      + p.r * p.K * dfR * normCdf(-d2)
      - p.q * p.S * dfQ * normCdf(-d1);
  const theta = thetaAnnual / 365;

  const rho = isCall
    ? (p.K * p.T * dfR * Nd2) / 100
    : (-p.K * p.T * dfR * normCdf(-d2)) / 100;

  // Second-order
  const vanna = (-dfQ * nd1 * d2) / p.sigma / 100;
  const volga = vega * (d1 * d2) / p.sigma;
  const charmAnnual = isCall
    ? -dfQ * (nd1 * (2 * (p.r - p.q) * p.T - d2 * p.sigma * sqrtT) / (2 * p.T * p.sigma * sqrtT) - p.q * Nd1)
    : -dfQ * (nd1 * (2 * (p.r - p.q) * p.T - d2 * p.sigma * sqrtT) / (2 * p.T * p.sigma * sqrtT) + p.q * normCdf(-d1));
  const charm = charmAnnual / 365;

  return { delta, gamma, vega, theta, rho, vanna, volga, charm };
}

/* ──────────────────────────────────────────────────────────
 * Cox-Ross-Rubinstein binomial tree (American or European)
 * ────────────────────────────────────────────────────────── */
export function binomialPrice(p: OptionParams, steps = 200, american = false): number {
  if (p.T <= 0) return Math.max(0, p.type === "call" ? p.S - p.K : p.K - p.S);
  const dt = p.T / steps;
  const u = Math.exp(p.sigma * Math.sqrt(dt));
  const d = 1 / u;
  const a = Math.exp((p.r - p.q) * dt);
  const pUp = (a - d) / (u - d);
  const disc = Math.exp(-p.r * dt);

  // Terminal payoffs
  const values = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const ST = p.S * Math.pow(u, steps - i) * Math.pow(d, i);
    values[i] = Math.max(0, p.type === "call" ? ST - p.K : p.K - ST);
  }

  // Backward induction
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      values[i] = disc * (pUp * values[i] + (1 - pUp) * values[i + 1]);
      if (american) {
        const ST = p.S * Math.pow(u, step - i) * Math.pow(d, i);
        const intrinsic = Math.max(0, p.type === "call" ? ST - p.K : p.K - ST);
        if (intrinsic > values[i]) values[i] = intrinsic;
      }
    }
  }
  return values[0];
}

/* ──────────────────────────────────────────────────────────
 * Monte Carlo (Geometric Brownian Motion) with antithetic variates
 * Returns price and 95% confidence interval half-width.
 * ────────────────────────────────────────────────────────── */
function gauss(): number {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export interface MCResult {
  price: number;
  stderr: number;
  ci95: [number, number];
  paths: number;
}

export function monteCarloPrice(p: OptionParams, paths = 20000): MCResult {
  if (p.T <= 0) {
    const v = Math.max(0, p.type === "call" ? p.S - p.K : p.K - p.S);
    return { price: v, stderr: 0, ci95: [v, v], paths };
  }
  const drift = (p.r - p.q - 0.5 * p.sigma * p.sigma) * p.T;
  const diff = p.sigma * Math.sqrt(p.T);
  const disc = Math.exp(-p.r * p.T);
  const n = Math.floor(paths / 2);

  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const z = gauss();
    const ST1 = p.S * Math.exp(drift + diff * z);
    const ST2 = p.S * Math.exp(drift - diff * z);
    const pay1 = Math.max(0, p.type === "call" ? ST1 - p.K : p.K - ST1);
    const pay2 = Math.max(0, p.type === "call" ? ST2 - p.K : p.K - ST2);
    const avg = 0.5 * (pay1 + pay2);
    sum += avg;
    sumSq += avg * avg;
  }
  const mean = sum / n;
  const variance = (sumSq / n - mean * mean);
  const stderr = disc * Math.sqrt(Math.max(variance, 0) / n);
  const price = disc * mean;
  return {
    price,
    stderr,
    ci95: [price - 1.96 * stderr, price + 1.96 * stderr],
    paths: n * 2,
  };
}

/* ──────────────────────────────────────────────────────────
 * Implied Volatility — Brent's method (robust, ~1e-6 precision)
 * ────────────────────────────────────────────────────────── */
export function impliedVol(
  marketPrice: number,
  base: Omit<OptionParams, "sigma">,
  loVol = 1e-4,
  hiVol = 5,
  tol = 1e-6,
  maxIter = 100,
): number | null {
  const f = (s: number) => blackScholes({ ...base, sigma: s }) - marketPrice;
  let a = loVol, b = hiVol;
  let fa = f(a), fb = f(b);
  if (fa * fb > 0) return null; // out of bracket
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, d = b - a, e = d;

  for (let i = 0; i < maxIter; i++) {
    if (fb === 0 || Math.abs(b - a) < tol) return b;
    if (fa !== fc && fb !== fc) {
      // Inverse quadratic interpolation
      const s = (a * fb * fc) / ((fa - fb) * (fa - fc))
              + (b * fa * fc) / ((fb - fa) * (fb - fc))
              + (c * fa * fb) / ((fc - fa) * (fc - fb));
      e = d; d = s - b;
      if ((s - (3 * a + b) / 4) * (s - b) >= 0) { d = (a - b) / 2; e = d; }
      const newB = b + d;
      const fnew = f(newB);
      c = b; fc = fb;
      if (fnew * fb < 0) { a = b; fa = fb; }
      b = newB; fb = fnew;
    } else {
      // Secant
      const newB = b - fb * (b - a) / (fb - fa);
      const fnew = f(newB);
      c = b; fc = fb;
      if (fnew * fb < 0) { a = b; fa = fb; }
      b = newB; fb = fnew;
    }
    if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  }
  return b;
}

/* ──────────────────────────────────────────────────────────
 * Volatility Surface synthesizer (Gatheral SVI-inspired skew)
 * Returns IV for a given moneyness (K/S) and tenor T.
 * Used to render a realistic surface without external data.
 * ────────────────────────────────────────────────────────── */
export function syntheticIV(moneyness: number, T: number, atmVol = 0.22): number {
  const k = Math.log(moneyness);                    // log-moneyness
  const skew = -0.18 * k;                            // negative skew (puts > calls)
  const smile = 0.55 * (k * k);                      // smile curvature
  const term = atmVol + 0.04 * Math.exp(-3 * T) - 0.02 * T;  // term structure
  return Math.max(0.05, term + skew + smile);
}

/* ──────────────────────────────────────────────────────────
 * Strategy payoff at expiration
 * ────────────────────────────────────────────────────────── */
export interface Leg {
  type: OptionType | "stock";
  strike: number;
  qty: number;       // +long, -short
  premium: number;   // paid (long) or received (short, stored positive)
}

export function strategyPayoff(legs: Leg[], spot: number): number {
  let pl = 0;
  for (const leg of legs) {
    if (leg.type === "stock") {
      pl += leg.qty * (spot - leg.strike);
    } else {
      const intrinsic = Math.max(0, leg.type === "call" ? spot - leg.strike : leg.strike - spot);
      // qty positive = long => paid premium; qty negative = short => received premium
      pl += leg.qty * intrinsic - leg.qty * leg.premium;
    }
  }
  return pl;
}
