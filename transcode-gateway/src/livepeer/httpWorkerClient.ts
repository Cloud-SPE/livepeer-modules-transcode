// Real WorkerClient that fetches a broker over HTTP, threads a freshly
// minted Livepeer-Payment header, and applies Livepeer-* metadata
// headers from headers.ts. Replaces stubWorkerClient when env vars are
// set (see src/index.ts wiring).

import { VideoCoreError } from "../engine/types/index.js";
import type { SelectedWorkerRoute } from "../engine/types/index.js";
import type { WorkerClient } from "../engine/interfaces/index.js";
import { HEADER, SPEC_VERSION } from "./headers.js";
import { newRequestId } from "./requestId.js";
import { createPaymentBuilder } from "./payment.js";
import type { PayerDaemonClient } from "./payerDaemonClient.js";
import { modeForCapability } from "./capabilityMap.js";
import type { Capability } from "../engine/types/index.js";

export interface HttpWorkerClientDeps {
  payerDaemon: PayerDaemonClient;
  nodeId: string;
  faceValueWei: string;
}

export function createHttpWorkerClient(deps: HttpWorkerClientDeps): WorkerClient {
  const buildPayment = createPaymentBuilder({ payerDaemon: deps.payerDaemon });

  return {
    async callWorker({ route, path, method, body, callerId, timeoutMs }) {
      const ticket = await buildPayment({
        callerId,
        capability: route.capability,
        offering: route.offering,
        workUnits: 1n,
        faceValueWei: deps.faceValueWei,
        recipientEthAddress: route.ethAddress,
        nodeId: deps.nodeId,
      });

      const headers: Record<string, string> = {
        "content-type": "application/json",
        [HEADER.CAPABILITY]: route.capability,
        [HEADER.OFFERING]: route.offering,
        [HEADER.PAYMENT]: ticket.header,
        [HEADER.MODE]: modeForCapability(route.capability as Capability),
        [HEADER.SPEC_VERSION]: SPEC_VERSION,
        [HEADER.REQUEST_ID]: newRequestId(),
      };

      const controller = new AbortController();
      const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const res = await fetch(`${stripTrailingSlash(route.workerUrl)}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new VideoCoreError(
            "WorkerError",
            `worker ${route.workerUrl}${path} returned ${res.status}: ${txt.slice(0, 200)}`,
          );
        }

        const ct = res.headers.get("content-type") ?? "";
        const parsed = ct.includes("application/json")
          ? await res.json()
          : await res.text();
        return parsed as never;
      } catch (err) {
        if (err instanceof VideoCoreError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new VideoCoreError(
            "WorkerError",
            `worker ${route.workerUrl}${path} timed out after ${timeoutMs}ms`,
          );
        }
        throw new VideoCoreError(
          "WorkerError",
          `worker ${route.workerUrl}${path} failed: ${(err as Error).message}`,
        );
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
    },
  };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
