import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../services/client.js";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface ApiOptions<T> {
  /** Poll every `pollMs` while `pollWhile(data)` returns true. Stops when it
   *  returns false (e.g. pipeline reached COMPLETE), on unmount, or on error. */
  pollMs?: number;
  pollWhile?: (data: T | null) => boolean;
}

/**
 * Runs an async endpoint fn on mount and whenever deps change. Returns the
 * unwrapped data plus loading/error flags. `reload` re-runs the same fn.
 * With `pollMs` + `pollWhile`, it refetches on an interval until the data
 * settles — used so views update live as the async pipeline progresses.
 */
export function useApi<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  options: ApiOptions<T> = {},
): ApiState<T> {
  const { pollMs, pollWhile } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const run = () => {
      fn()
        .then((d) => {
          if (!alive) return;
          setData(d);
          if (pollMs && pollWhile?.(d)) {
            clearTimer();
            timer.current = setTimeout(run, pollMs);
          }
        })
        .catch((err) => {
          if (!alive) return;
          setError(err instanceof ApiError ? err.message : String(err));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };

    run();
    return () => {
      alive = false;
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
