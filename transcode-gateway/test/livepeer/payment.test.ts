import { test } from "node:test";
import assert from "node:assert/strict";

import { createPaymentBuilder } from "../../src/livepeer/payment.js";
import type {
  CreatePaymentRequest,
  PayerDaemonClient,
} from "../../src/livepeer/payerDaemonClient.js";

function captureClient(
  resolveWith: { paymentHeader: string } = { paymentHeader: "lp-payment-bytes-abc" },
): {
  client: PayerDaemonClient;
  requests: CreatePaymentRequest[];
} {
  const requests: CreatePaymentRequest[] = [];
  return {
    requests,
    client: {
      async createPayment(req) {
        requests.push(req);
        return resolveWith;
      },
      async close() {},
    },
  };
}

test("buildPayment forwards accepted_price and funding from the selected route", async () => {
  const { client, requests } = captureClient();
  const builder = createPaymentBuilder({ payerDaemon: client });

  const out = await builder({
    capability: "video:transcode.abr",
    offering: "abr-default",
    workUnits: 3n,
    fundedValueWei: "1000000000000000",
    recipientEthAddress: "0x1234567890abcdef1234567890abcdef12345678",
    brokerUrl: "https://broker.example.com/",
    workUnit: "seconds",
    pricePerWorkUnitWei: "2500",
    unitsPerPrice: 2,
    quoteId: "quote-1",
    quoteVersion: 7,
    constraintFingerprint: Uint8Array.from([1, 2, 3]),
    routeFingerprint: Uint8Array.from([4, 5, 6]),
  });

  assert.equal(out.header, "lp-payment-bytes-abc");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    recipientEthAddress: "0x1234567890abcdef1234567890abcdef12345678",
    ticketParamsBaseUrl: "https://broker.example.com",
    acceptedPrice: {
      pricePerUnitWei: "2500",
      unitsPerPrice: 2,
      workUnitName: "seconds",
      capability: "video:transcode.abr",
      offering: "abr-default",
      quoteRef: {
        quoteId: "quote-1",
        quoteVersion: 7,
        constraintFingerprint: Uint8Array.from([1, 2, 3]),
        routeFingerprint: Uint8Array.from([4, 5, 6]),
      },
    },
    funding: {
      estimatedUnits: 3,
      fundedValueWei: "1000000000000000",
      maxTotalUnits: 3,
    },
  });
});

test("buildPayment defaults units_per_price to 1 when resolver omits it", async () => {
  const { client, requests } = captureClient();
  const builder = createPaymentBuilder({ payerDaemon: client });

  await builder({
    capability: "video:live.rtmp",
    offering: "default",
    workUnits: 1n,
    fundedValueWei: "42",
    recipientEthAddress: "0x1234567890abcdef1234567890abcdef12345678",
    brokerUrl: "https://broker.example.com",
    workUnit: "seconds",
    pricePerWorkUnitWei: "99",
    unitsPerPrice: null,
    quoteId: "quote-2",
    quoteVersion: 1,
    constraintFingerprint: Uint8Array.from([1]),
    routeFingerprint: Uint8Array.from([2]),
  });

  assert.equal(requests[0]?.acceptedPrice.unitsPerPrice, 1);
});

test("buildPayment rejects routes missing quote metadata", async () => {
  const { client } = captureClient();
  const builder = createPaymentBuilder({ payerDaemon: client });

  await assert.rejects(
    () =>
      builder({
        capability: "video:transcode.abr",
        offering: "abr-default",
        workUnits: 1n,
        fundedValueWei: "1",
        recipientEthAddress: "0x1234567890abcdef1234567890abcdef12345678",
        brokerUrl: "https://broker.example.com",
        workUnit: "seconds",
        pricePerWorkUnitWei: "1",
        unitsPerPrice: 1,
        quoteId: null,
        quoteVersion: 1,
        constraintFingerprint: Uint8Array.from([1]),
        routeFingerprint: Uint8Array.from([2]),
      }),
    /quote_ref metadata/,
  );
});

test("buildPayment surfaces payer-daemon errors", async () => {
  const builder = createPaymentBuilder({
    payerDaemon: {
      async createPayment() {
        throw new Error("daemon unreachable");
      },
      async close() {},
    },
  });

  await assert.rejects(
    () =>
      builder({
        capability: "video:live.rtmp",
        offering: "default",
        workUnits: 1n,
        fundedValueWei: "1",
        recipientEthAddress: "0x1234567890abcdef1234567890abcdef12345678",
        brokerUrl: "https://broker.example.com",
        workUnit: "seconds",
        pricePerWorkUnitWei: "1",
        unitsPerPrice: 1,
        quoteId: "quote-3",
        quoteVersion: 2,
        constraintFingerprint: Uint8Array.from([1]),
        routeFingerprint: Uint8Array.from([2]),
      }),
    /daemon unreachable/,
  );
});
