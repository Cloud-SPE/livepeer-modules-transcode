// Modeled on livepeer-network-modules/video-gateway/src/livepeer/payment.ts.

import type { PayerDaemonClient } from "./payerDaemonClient.js";

export interface PaymentBuildInput {
  capability: string;
  offering: string;
  workUnits: bigint;
  fundedValueWei: string;
  recipientEthAddress: string;
  brokerUrl: string;
  workUnit: string;
  pricePerWorkUnitWei: string;
  unitsPerPrice: number | null | undefined;
  quoteId: string | null | undefined;
  quoteVersion: number | null | undefined;
  constraintFingerprint: Uint8Array | null | undefined;
  routeFingerprint: Uint8Array | null | undefined;
}

export interface PaymentTicket {
  header: string;
}

export interface PaymentBuilderDeps {
  payerDaemon: PayerDaemonClient;
}

export function createPaymentBuilder(deps: PaymentBuilderDeps) {
  return async function buildPayment(input: PaymentBuildInput): Promise<PaymentTicket> {
    const unitsPerPrice = input.unitsPerPrice ?? 1;
    if (!input.quoteId || input.quoteVersion === null || input.quoteVersion === undefined) {
      throw new Error("resolver selected route missing quote_ref metadata");
    }
    if (!input.constraintFingerprint || input.constraintFingerprint.length === 0) {
      throw new Error("resolver selected route missing constraint_fingerprint");
    }
    if (!input.routeFingerprint || input.routeFingerprint.length === 0) {
      throw new Error("resolver selected route missing route_fingerprint");
    }
    if (unitsPerPrice <= 0) {
      throw new Error("resolver selected route has invalid units_per_price");
    }

    const estimatedUnits = bigintToSafeInteger(input.workUnits, "workUnits");
    const resp = await deps.payerDaemon.createPayment({
      recipientEthAddress: input.recipientEthAddress,
      ticketParamsBaseUrl: stripTrailingSlash(input.brokerUrl),
      acceptedPrice: {
        pricePerUnitWei: input.pricePerWorkUnitWei,
        unitsPerPrice,
        workUnitName: input.workUnit,
        capability: input.capability,
        offering: input.offering,
        quoteRef: {
          quoteId: input.quoteId,
          quoteVersion: input.quoteVersion,
          constraintFingerprint: input.constraintFingerprint,
          routeFingerprint: input.routeFingerprint,
        },
      },
      funding: {
        estimatedUnits,
        fundedValueWei: input.fundedValueWei,
        maxTotalUnits: estimatedUnits,
      },
    });
    return { header: resp.paymentHeader };
  };
}

function bigintToSafeInteger(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds supported range`);
  }
  return Number(value);
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
