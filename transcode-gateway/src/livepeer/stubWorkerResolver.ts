import type { WorkerResolver } from "../engine/interfaces/index.js";

// Stub WorkerResolver used until the real resolver wire lands in plan 0004.
// Always returns null ("no workers available"); the engine's orchestrator
// already handles that case by marking the asset errored with code
// NoWorkersAvailable.

export function createStubWorkerResolver(): WorkerResolver {
  return {
    async selectWorker() {
      return null;
    },
  };
}
