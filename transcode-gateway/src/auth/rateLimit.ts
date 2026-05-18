// In-memory per-key token bucket. Modeled on
// blue-claw-network/web-platform/backend/src/routes/waitlist.rs::check_rate_limit
// + spawn_rate_limit_sweep. Single-instance only; multi-instance is a
// phase-2 ticket.

export interface RateLimiter {
  check(key: string, maxRequests: number, windowSecs: number): boolean;
  stop(): void;
}

export function createRateLimiter(sweepIntervalMs = 60_000): RateLimiter {
  const map = new Map<string, number[]>();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [key, stamps] of map) {
      const kept = stamps.filter((t) => t > cutoff);
      if (kept.length === 0) {
        map.delete(key);
      } else if (kept.length !== stamps.length) {
        map.set(key, kept);
      }
    }
  }, sweepIntervalMs);
  sweep.unref();

  return {
    check(key, maxRequests, windowSecs) {
      const now = Date.now();
      const cutoff = now - windowSecs * 1000;
      const entries = map.get(key) ?? [];
      const fresh = entries.filter((t) => t > cutoff);
      if (fresh.length >= maxRequests) {
        map.set(key, fresh);
        return false;
      }
      fresh.push(now);
      map.set(key, fresh);
      return true;
    },
    stop() {
      clearInterval(sweep);
      map.clear();
    },
  };
}
