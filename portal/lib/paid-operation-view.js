const TERMINAL = new Set(["settled", "encumbered", "failed", "debit_failed"]);

export function shouldPollOperation(operation) {
  return operation !== null && !TERMINAL.has(operation.state);
}

export function operationTone(operation) {
  if (!operation) return "";
  if (operation.state === "settled") return "ok";
  if (TERMINAL.has(operation.state) || operation.error_code === "debit_failed") return "error";
  return "warn";
}

export function operationSummary(operation) {
  if (!operation) return "No paid operation has been recorded yet.";
  if (operation.state === "settled") {
    return `Settled ${operation.claimed_units ?? "0"} ${operation.work_unit}.`;
  }
  if (operation.error_code === "debit_failed" || operation.state === "encumbered") {
    return "Payment could not be finalized; the result remains unavailable.";
  }
  if (operation.winddown_reason) {
    return `Ending safely (${operation.winddown_reason.replaceAll("_", " ")}); settlement is still pending.`;
  }
  if (operation.recovered) return "Recovered after an interrupted exchange; reconciliation is continuing.";
  return "The paid exchange is still in progress.";
}
