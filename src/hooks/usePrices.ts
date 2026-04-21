import { useEffect, useState, useCallback } from "react";
import { fetchPrices, type PricesResponse } from "@/lib/twelvedata";

interface UsePricesState {
  data: PricesResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const CLIENT_CACHE_TTL_MS = 15 * 1000;
const AUTO_REFRESH_MS = 30 * 1000;
const cache = new Map<string, { data: PricesResponse; fetchedAt: number }>();

export function usePrices(symbol: string): UsePricesState {
  const [data, setData] = useState<PricesResponse | null>(() => cache.get(symbol)?.data ?? null);
  const [loading, setLoading] = useState(!cache.has(symbol));
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!symbol) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const json = await fetchPrices(symbol);
        cache.set(symbol, { data: json, fetchedAt: Date.now() });
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!cache.has(symbol)) setData(null);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    const cached = cache.get(symbol);
    if (cached) {
      setData(cached.data);
      setLoading(false);
      if (Date.now() - cached.fetchedAt > CLIENT_CACHE_TTL_MS) {
        void run({ silent: true });
      }
    } else {
      void run();
    }
  }, [symbol, run]);

  useEffect(() => {
    if (!symbol) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void run({ silent: true });
    };
    const interval = window.setInterval(refresh, AUTO_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [symbol, run]);

  return { data, loading, error, refetch: () => void run() };
}
