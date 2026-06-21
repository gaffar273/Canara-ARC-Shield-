import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../services/client.js";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs an async endpoint fn on mount and whenever deps change. Returns the
 * unwrapped data plus loading/error flags. `reload` re-runs the same fn.
 */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
