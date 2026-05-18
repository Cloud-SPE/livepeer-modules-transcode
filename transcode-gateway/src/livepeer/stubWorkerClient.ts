import { VideoCoreError } from "../engine/types/index.js";
import type { WorkerClient } from "../engine/interfaces/index.js";

// Stub WorkerClient used until the real wire layer lands in plan 0004.
// Any call to callWorker(...) throws NotImplemented so an attempt to
// dispatch a job in v0 fails loudly rather than silently.

export function createStubWorkerClient(): WorkerClient {
  return {
    async callWorker() {
      throw new VideoCoreError(
        "NotImplemented",
        "worker client not yet wired — see docs/exec-plans/active/0004-wire-layer.md (queued)",
      );
    },
  };
}
