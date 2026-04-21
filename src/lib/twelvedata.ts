/**
 * Twelve Data client (browser-side).
 * Free tier: 800 req/day, 8 req/min.
 * Supports stocks, ETFs, FX, and crypto in one API.
 *   Stock:  AAPL, SPY, QQQ
 *   Crypto: BTCUSD -> BTC/USD
 *   FX:     EURUSD -> EUR/USD
 */

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PricesResponse {
  symbol: string;
  count: number;
  bars: PriceBar[];
}

export interface BatchPricesResponse {
  series: PricesResponse[];
  errors: Array<{ symbol: string; message: string }>;
}

const TWELVEDATA_API_KEY =
  (import.meta.env.VITE_TWELVEDATA_API_KEY as string | undefined) ??
  "Add_your_twelvedata_api_here";

const PRICE_CACHE_TTL_MS = 5 * 60 * 100; // 5 minutes
const priceCache = new Map<string, { expiresAt: number; data: PricesResponse }>();
const inflight = new Map<string, Promise<PricesResponse>>();

const CRYPTO_BASES = new Set([
  "BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX",
  "DOT", "LINK", "MATIC", "LTC", "BCH", "BNB", "TRX",
]);

const FX_QUOTES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"]);

function resolveSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();

  // Crypto bare ticker -> BTC/USD
  if (CRYPTO_BASES.has(s)) return `${s}/USD`;

  // Crypto pair like BTCUSD -> BTC/USD
  const cryptoMatch = s.match(/^(BTC|ETH|SOL|DOGE|XRP|ADA|AVAX|DOT|LINK|MATIC|LTC|BCH|BNB|TRX)(USD|USDT)$/);
  if (cryptoMatch) return `${cryptoMatch[1]}/USD`;

  // FX pair like EURUSD -> EUR/USD
  if (/^[A-Z]{6}$/.test(s)) {
    const base = s.slice(0, 3);
    const quote = s.slice(3);
    if (FX_QUOTES.has(base) && FX_QUOTES.has(quote)) {
      return `${base}/${quote}`;
    }
  }

  // Already slash-formatted
  if (s.includes("/")) return s;

  // Default: equity / ETF
  return s;
}

interface TimeSeriesValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface TimeSeriesResponse {
  meta?: { symbol: string; interval: string; type?: string };
  values?: TimeSeriesValue[];
  status?: string;
  code?: number;
  message?: string;
}

interface QuoteResponse {
  symbol?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  datetime?: string;
  timestamp?: number;
  status?: string;
  code?: number;
  message?: string;
}

async function fetchTimeSeries(resolvedSymbol: string): Promise<PriceBar[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    resolvedSymbol,
  )}&interval=1day&outputsize=800&order=asc&apikey=${TWELVEDATA_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status}`);
  }

  const json = (await res.json()) as TimeSeriesResponse;

  if (json.status === "error" || json.code) {
    const msg = json.message ?? "unknown error";
    if (json.code === 401 || json.code === 403) {
      throw new Error("Twelve Data auth failed — check API key");
    }
    if (json.code === 429) {
      throw new Error("Twelve Data rate limit hit (8/min, 800/day on free tier)");
    }
    throw new Error(`Twelve Data: ${msg}`);
  }

  if (!json.values || json.values.length === 0) {
    throw new Error(`No data returned for ${resolvedSymbol}`);
  }

  const bars: PriceBar[] = [];
  for (const v of json.values) {
    const close = parseFloat(v.close);
    if (!Number.isFinite(close)) continue;
    bars.push({
      date: v.datetime.slice(0, 10),
      open: parseFloat(v.open) || close,
      high: parseFloat(v.high) || close,
      low: parseFloat(v.low) || close,
      close,
      volume: v.volume ? parseFloat(v.volume) : 0,
    });
  }
  return bars;
}

async function fetchLiveQuote(resolvedSymbol: string): Promise<PriceBar | null> {
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
      resolvedSymbol,
    )}&apikey=${TWELVEDATA_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const q = (await res.json()) as QuoteResponse;
    if (q.status === "error" || q.code) return null;
    if (!q.close || !q.datetime) return null;
    const close = parseFloat(q.close);
    if (!Number.isFinite(close)) return null;
    return {
      date: q.datetime.slice(0, 10),
      open: q.open ? parseFloat(q.open) : close,
      high: q.high ? parseFloat(q.high) : close,
      low: q.low ? parseFloat(q.low) : close,
      close,
      volume: q.volume ? parseFloat(q.volume) : 0,
    };
  } catch {
    return null;
  }
}

function mergeLive(series: PricesResponse, live: PriceBar | null): PricesResponse {
  if (!live) return series;
  const bars = series.bars.slice();
  const last = bars[bars.length - 1];
  if (!last) return series;
  if (live.date === last.date) {
    bars[bars.length - 1] = { ...last, ...live };
    return { ...series, bars };
  }
  if (live.date > last.date) {
    bars.push(live);
    return { ...series, count: bars.length, bars };
  }
  return series;
}

async function getCachedPrices(rawSymbol: string): Promise<PricesResponse> {
  const resolved = resolveSymbol(rawSymbol);
  const cacheKey = resolved;

  const cached = priceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      const bars = await fetchTimeSeries(resolved);
      let data: PricesResponse = { symbol: rawSymbol.toUpperCase(), count: bars.length, bars };

      try {
        const live = await fetchLiveQuote(resolved);
        data = mergeLive(data, live);
      } catch {
        /* ignore */
      }

      priceCache.set(cacheKey, { data, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
      return data;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, request);
  return request;
}

export async function fetchPrices(symbol: string): Promise<PricesResponse> {
  return getCachedPrices(symbol);
}

export async function fetchBatchPrices(symbols: string[]): Promise<BatchPricesResponse> {
  const series: PricesResponse[] = [];
  const errors: Array<{ symbol: string; message: string }> = [];

  for (let i = 0; i < symbols.length; i++) {
    const raw = symbols[i];

    try {
      series.push(await getCachedPrices(raw));
    } catch (error) {
      errors.push({
        symbol: raw,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // 🔥 STRICT throttle: 1.2 seconds per call
    if (i < symbols.length - 1) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  return { series, errors };
}
