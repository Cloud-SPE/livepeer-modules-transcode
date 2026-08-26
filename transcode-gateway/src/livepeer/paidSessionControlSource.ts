import { WebSocket } from "undici";
import type { PaidSessionControlSource } from "../engine/service/paidLiveReconciler.js";

export function createPaidSessionControlSource(windowMs: number): PaidSessionControlSource {
  if (!Number.isSafeInteger(windowMs) || windowMs < 10 || windowMs > 10_000) {
    throw new Error("paid session control window is invalid");
  }
  return {
    read(input) {
      const url = new URL(input.eventsWs);
      if ((url.protocol !== "ws:" && url.protocol !== "wss:") || url.username || url.password || url.hash) {
        return Promise.reject(new Error("paid session control URL is invalid"));
      }
      return new Promise<unknown[]>((resolve, reject) => {
        const frames: unknown[] = [];
        const socket = new WebSocket(url, {
          headers: { Authorization: `Bearer ${input.credential}` },
        });
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.close(1000, "reconcile");
          if (error && frames.length === 0) reject(error);
          else resolve(frames);
        };
        const timer = setTimeout(() => finish(), windowMs);
        socket.addEventListener("message", (event) => {
          try {
            const data = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
            frames.push(JSON.parse(data) as unknown);
          } catch {
            finish(new Error("paid session control frame is invalid"));
          }
        });
        socket.addEventListener("error", () => finish(new Error("paid session control unavailable")));
        socket.addEventListener("close", () => finish());
      });
    },
  };
}
