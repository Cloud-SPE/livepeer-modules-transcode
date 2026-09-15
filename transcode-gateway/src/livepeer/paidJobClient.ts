import { z } from "zod";
import { createHash } from "node:crypto";
import type {
  LocClient,
  LocOpenJobResult,
  LocSettlementEnvelope,
  PaidJobClient,
  PaidJobRequest,
  PaidJobResult,
  PaidJobSettlement,
  PaidJobUnresolvedResult,
} from "../engine/interfaces/index.js";
import { PaidJobClientError } from "../engine/interfaces/index.js";
import { HEADER } from "./headers.js";
import { routeBindingFor } from "./locClient.js";
import { classifyV2Failure } from "./v2Outcome.js";
import type { CallerProofIdentity } from "./callerProof.js";

const PROTOCOL = "paid-job/v1";
const UINT64 = /^(0|[1-9][0-9]*)$/;
const exchangeWire = z
  .object({
    request_id: z.string().min(1),
    job_id: z.string().min(1).optional(),
    outcome: z.enum([
      "IN_FLIGHT",
      "ACCOUNTING_PENDING",
      "SETTLED",
      "NOT_ADMITTED",
      "ADMITTED_OUTCOME_UNKNOWN",
      "ADMITTED_EVIDENCE_EXPIRED",
      "NO_RECORD",
    ]),
    work_units: z.union([z.number().int().nonnegative(), z.string().regex(UINT64)]).optional(),
    unit: z.string().min(1).optional(),
    settlement: z.string().min(1).optional(),
    non_admission: z.string().min(1).optional(),
  })
  .passthrough();
const settlementWire = z
  .object({
    payload: z.record(z.string(), z.json()),
    signature: z
      .object({
        algorithm: z.literal("secp256k1"),
        canonicalization: z.literal("jcs"),
        value: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .strict(),
  })
  .strict();

export interface PaidJobClientOptions {
  fetch?: typeof globalThis.fetch;
  caller: CallerProofIdentity;
  accountingPollAttempts?: number;
  accountingPollDelayMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

export function createPaidJobClient(
  loc: LocClient,
  options: PaidJobClientOptions,
): PaidJobClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const pollAttempts = options.accountingPollAttempts ?? 8;
  const pollDelayMs = options.accountingPollDelayMs ?? 250;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function recover(opened: LocOpenJobResult) {
    return recoverExchange(loc, fetchImpl, opened, pollAttempts, pollDelayMs, delay);
  }

  return {
    async execute(input: PaidJobRequest): Promise<PaidJobResult> {
      validateRequest(input);
      const opened = await loc.openJob({
        requestId: input.requestId,
        capability: input.route.capability,
        offering: input.route.offering,
        transport: input.transport,
        estimatedUnits: input.estimatedUnits,
        ...(input.maxTotalUnits === undefined ? {} : { maxTotalUnits: input.maxTotalUnits }),
        routeBinding: routeBindingFor(input.route),
        workloadRequestDigest: createHash("sha256").update(input.body).digest("hex"),
        callerPublicKey: options.caller.publicKey,
      });
      const headers = new Headers({
        [HEADER.CAPABILITY]: opened.routeSnapshot.capability,
        [HEADER.OFFERING]: opened.routeSnapshot.offering,
        [HEADER.AUTHORIZATION]: opened.spendAuthorization,
        [HEADER.CALLER_PROOF]: options.caller.signAuthorization(opened.spendAuthorization),
        [HEADER.PROTOCOL]: PROTOCOL,
        [HEADER.REQUEST_ID]: opened.requestId,
        "Content-Type": input.contentType,
      });
      if (opened.paymentEnvelope) headers.set(HEADER.PAYMENT, opened.paymentEnvelope);
      if (input.transport === "stream") headers.set("Accept", "text/event-stream");

      let response: Response;
      try {
        response = await fetchImpl(jobUrl(opened.brokerUrl), {
          method: "POST",
          headers,
          body: Buffer.from(input.body),
        });
      } catch (cause) {
        const recovered = await recover(opened).catch((recoveryCause: unknown) => {
          throw new PaidJobClientError("paid_job_outcome_unknown", {
            retryable: true,
            cause: recoveryCause ?? cause,
          });
        });
        return recovered.kind === "settled"
          ? {
              ...recovered,
              brokerStatus: null,
              brokerContentType: null,
              brokerBody: null,
            }
          : recovered;
      }

      const brokerBody = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) {
        const error = brokerError(response, brokerBody);
        if (error.code === "capacity_exhausted") {
          const brokerJobId = response.headers.get(HEADER.JOB_ID);
          const encodedSettlement = response.headers.get(HEADER.SETTLEMENT);
          const units = response.headers.get(HEADER.WORK_UNITS);
          const unit = response.headers.get(HEADER.WORK_UNIT);
          if (brokerJobId && encodedSettlement && units === "0" && unit) {
            await settle(loc, opened, {
              brokerJobId,
              actualUnits: 0,
              workUnit: unit,
              envelope: decodeSettlement(encodedSettlement),
            }, undefined, brokerBody);
          } else {
            const recovered = await recover(opened);
            if (recovered.kind !== "settled" || recovered.settlement.actualUnits !== 0) {
              throw new PaidJobClientError("paid_job_outcome_unknown", { retryable: true });
            }
          }
          throw error;
        }
        if (error.code === "job_in_flight" || error.code === "accounting_pending") {
          const recovered = await recover(opened);
          return recovered.kind === "settled"
            ? {
                ...recovered,
                brokerStatus: null,
                brokerContentType: null,
                brokerBody: null,
              }
            : recovered;
        }
        throw error;
      }

      const brokerJobId = response.headers.get(HEADER.JOB_ID);
      const encodedSettlement = response.headers.get(HEADER.SETTLEMENT);
      const units = response.headers.get(HEADER.WORK_UNITS);
      const unit = response.headers.get(HEADER.WORK_UNIT);
      let terminal;
      if (brokerJobId && encodedSettlement && units && unit) {
        terminal = await settle(loc, opened, {
          brokerJobId,
          actualUnits: safeUnits(units),
          workUnit: unit,
          envelope: decodeSettlement(encodedSettlement),
        }, input.validateTerminal, brokerBody);
      } else if (brokerJobId) {
        const recovered = await pollSettlement(
          loc,
          fetchImpl,
          opened,
          brokerJobId,
          pollAttempts,
          pollDelayMs,
          delay,
          input.validateTerminal,
          brokerBody,
        );
        if (recovered.kind !== "settled") return recovered;
        terminal = recovered;
      } else {
        const recovered = await recover(opened);
        if (recovered.kind !== "settled") return recovered;
        terminal = recovered;
      }
      return {
        kind: "settled",
        opened,
        brokerStatus: response.status,
        brokerContentType: response.headers.get("content-type"),
        brokerBody,
        settlement: terminal.settlement,
        accounting: terminal.accounting,
      };
    },
    recover,
  };
}

async function recoverExchange(
  loc: LocClient,
  fetchImpl: typeof globalThis.fetch,
  opened: LocOpenJobResult,
  pollAttempts: number,
  pollDelayMs: number,
  delay: (milliseconds: number) => Promise<void>,
) {
  const response = await fetchImpl(
    `${opened.brokerUrl.replace(/\/$/, "")}/v1/exchange/${encodeURIComponent(opened.requestId)}`,
  );
  const value = exchangeWire.safeParse(await response.json());
  if (!value.success || value.data.request_id !== opened.requestId) throw invalidEvidence();
  const exchange = value.data;
  if (exchange.outcome === "SETTLED") {
    return settleFromExchange(loc, opened, exchange);
  }
  if (exchange.outcome === "ACCOUNTING_PENDING" && exchange.job_id) {
    return pollSettlement(loc, fetchImpl, opened, exchange.job_id, pollAttempts, pollDelayMs, delay);
  }
  return unresolved(opened, exchange);
}

async function pollSettlement(
  loc: LocClient,
  fetchImpl: typeof globalThis.fetch,
  opened: LocOpenJobResult,
  brokerJobId: string,
  attempts: number,
  delayMs: number,
  delay: (milliseconds: number) => Promise<void>,
  validateTerminal?: PaidJobRequest["validateTerminal"],
  brokerBody = new Uint8Array(),
): Promise<Awaited<ReturnType<typeof settle>> | PaidJobUnresolvedResult> {
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const response = await fetchImpl(
      `${opened.brokerUrl.replace(/\/$/, "")}/v1/settlement/${encodeURIComponent(brokerJobId)}`,
    );
    const raw = await response.json();
    if (response.status === 200) {
      const value = exchangeWire.safeParse({ ...asRecord(raw), outcome: "SETTLED", request_id: opened.requestId });
      if (!value.success) throw invalidEvidence();
      return settleFromExchange(loc, opened, value.data, validateTerminal, brokerBody);
    }
    if (response.status !== 202) throw brokerLookupError(response);
    const state = asRecord(raw).state;
    if (state !== "accounting_pending" && state !== "in_flight" && state !== "admitted") {
      throw invalidEvidence();
    }
    if (attempt + 1 < attempts) await delay(delayMs);
  }
  return { kind: "accounting_pending", opened, brokerJobId };
}

async function settleFromExchange(
  loc: LocClient,
  opened: LocOpenJobResult,
  exchange: z.infer<typeof exchangeWire>,
  validateTerminal?: PaidJobRequest["validateTerminal"],
  brokerBody = new Uint8Array(),
) {
  if (!exchange.job_id || exchange.work_units === undefined || !exchange.unit || !exchange.settlement) {
    throw invalidEvidence();
  }
  return settle(loc, opened, {
    brokerJobId: exchange.job_id,
    actualUnits: safeUnits(exchange.work_units),
    workUnit: exchange.unit,
    envelope: decodeSettlement(exchange.settlement),
  }, validateTerminal, brokerBody);
}

async function settle(
  loc: LocClient,
  opened: LocOpenJobResult,
  claim: Omit<PaidJobSettlement, "outcome">,
  validateTerminal?: PaidJobRequest["validateTerminal"],
  brokerBody = new Uint8Array(),
) {
  const settlement = validateSettlement(opened, claim);
  await validateTerminal?.({ brokerBody, settlement });
  const accounting = await loc.settleJob({
    operationId: opened.operationId,
    actualUnits: settlement.actualUnits,
    brokerJobId: settlement.brokerJobId,
    workUnit: settlement.workUnit,
    outcome: settlement.outcome,
    settlement: settlement.envelope,
  });
  if (accounting.workId !== opened.workId) throw invalidEvidence();
  return { kind: "settled" as const, opened, settlement, accounting };
}

function validateSettlement(
  opened: LocOpenJobResult,
  claim: Omit<PaidJobSettlement, "outcome">,
): PaidJobSettlement {
  const payload = claim.envelope.payload;
  const quote = asRecord(payload.accepted_quote_ref);
  const actualUnits = safeUnits(payload.actual_units);
  const outcome = requiredString(payload.outcome);
  if (
    outcome === "DEBIT_FAILED" ||
    requiredString(payload.request_id) !== opened.requestId ||
    requiredString(payload.job_id) !== claim.brokerJobId ||
    requiredString(payload.work_id) !== opened.workId ||
    requiredString(payload.authorization_id) !== opened.workId ||
    requiredString(payload.settlement_domain_id) !== opened.routeSnapshot.settlementDomainId ||
    requiredString(payload.work_unit_name) !== opened.workUnit ||
    claim.workUnit !== opened.workUnit ||
    actualUnits !== claim.actualUnits ||
    safeUnits(payload.billed_units) !== actualUnits ||
    safeUnits(payload.debited_units) !== actualUnits ||
    requiredString(quote.quote_id) !== opened.routeSnapshot.binding.quoteId ||
    requiredString(quote.quote_version) !== opened.routeSnapshot.binding.quoteVersion ||
    requiredString(quote.constraint_fingerprint) !== hexAsBase64(opened.routeSnapshot.binding.constraintFingerprint) ||
    requiredString(quote.route_fingerprint) !== hexAsBase64(opened.routeSnapshot.binding.routeFingerprint)
  ) {
    throw new PaidJobClientError(
      outcome === "DEBIT_FAILED" ? "paid_job_debit_failed" : "paid_job_settlement_identity_mismatch",
      { retryable: false },
    );
  }
  return { ...claim, actualUnits, outcome };
}

function unresolved(
  opened: LocOpenJobResult,
  exchange: z.infer<typeof exchangeWire>,
): PaidJobUnresolvedResult {
  switch (exchange.outcome) {
    case "IN_FLIGHT":
      if (!exchange.job_id) throw invalidEvidence();
      return { kind: "in_flight", opened, brokerJobId: exchange.job_id };
    case "ACCOUNTING_PENDING":
      if (!exchange.job_id) throw invalidEvidence();
      return { kind: "accounting_pending", opened, brokerJobId: exchange.job_id };
    case "NOT_ADMITTED":
      if (!exchange.non_admission) throw invalidEvidence();
      return { kind: "not_admitted", opened, evidence: exchange.non_admission };
    case "NO_RECORD":
      return { kind: "no_record", opened };
    case "ADMITTED_OUTCOME_UNKNOWN":
      if (!exchange.job_id) throw invalidEvidence();
      return { kind: "admitted_outcome_unknown", opened, brokerJobId: exchange.job_id };
    case "ADMITTED_EVIDENCE_EXPIRED":
      if (!exchange.job_id) throw invalidEvidence();
      return { kind: "admitted_evidence_expired", opened, brokerJobId: exchange.job_id };
    case "SETTLED":
      throw invalidEvidence();
  }
}

function validateRequest(input: PaidJobRequest): void {
  if (
    input.route.protocol !== PROTOCOL ||
    !input.route.job?.transports.includes(input.transport) ||
    input.requestId.length === 0 ||
    input.contentType.length === 0 ||
    !Number.isSafeInteger(input.estimatedUnits) ||
    input.estimatedUnits < 1 ||
    (input.maxTotalUnits !== undefined &&
      (!Number.isSafeInteger(input.maxTotalUnits) || input.maxTotalUnits < input.estimatedUnits))
  ) {
    throw new PaidJobClientError("paid_job_request_invalid", { retryable: false });
  }
}

function decodeSettlement(encoded: string): LocSettlementEnvelope {
  try {
    const parsed = settlementWire.safeParse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
    if (!parsed.success) throw parsed.error;
    return parsed.data as LocSettlementEnvelope;
  } catch (cause) {
    throw new PaidJobClientError("paid_job_settlement_invalid", { retryable: false, cause });
  }
}

function safeUnits(value: unknown): number {
  const text = typeof value === "number" ? String(value) : requiredString(value);
  if (!UINT64.test(text)) throw invalidEvidence();
  const units = Number(text);
  if (!Number.isSafeInteger(units)) throw invalidEvidence();
  return units;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw invalidEvidence();
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidEvidence();
  return value as Record<string, unknown>;
}

function hexAsBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

function jobUrl(brokerUrl: string): string {
  return `${brokerUrl.replace(/\/$/, "")}/v1/job`;
}

function brokerError(response: Response, body: Uint8Array): PaidJobClientError {
  let code = response.headers.get(HEADER.ERROR) ?? "paid_job_broker_refused";
  try {
    const parsed = JSON.parse(Buffer.from(body).toString("utf8")) as { error?: { code?: unknown }; code?: unknown };
    const candidate = parsed.error?.code ?? parsed.code;
    if (typeof candidate === "string" && candidate.length > 0) code = candidate;
  } catch {
    // The typed header remains authoritative when the body is not JSON.
  }
  return new PaidJobClientError(code, {
    retryable: classifyV2Failure(code, response.status).retryable,
  });
}

function brokerLookupError(response: Response): PaidJobClientError {
  return new PaidJobClientError(response.headers.get(HEADER.ERROR) ?? "paid_job_recovery_failed", {
    retryable: classifyV2Failure(response.headers.get(HEADER.ERROR) ?? "", response.status).retryable,
  });
}

function invalidEvidence(): PaidJobClientError {
  return new PaidJobClientError("paid_job_evidence_invalid", { retryable: false });
}
