import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const PROTO_FILES = [
  "livepeer/payments/v1/types.proto",
  "livepeer/payments/v1/payer_daemon.proto",
];

export interface CreatePaymentRequest {
  recipientEthAddress: string;
  ticketParamsBaseUrl: string;
  acceptedPrice: {
    pricePerUnitWei: string;
    unitsPerPrice: number;
    workUnitName: string;
    capability: string;
    offering: string;
    quoteRef: {
      quoteId: string;
      quoteVersion: number;
      constraintFingerprint: Uint8Array;
      routeFingerprint: Uint8Array;
    };
  };
  funding: {
    estimatedUnits: number;
    fundedValueWei: string;
    maxTotalUnits: number;
    topUpAllowed?: boolean;
  };
}

export interface CreatePaymentResponse {
  paymentHeader: string;
}

export interface PayerDaemonClient {
  createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResponse>;
  close(): Promise<void>;
}

export interface PayerDaemonClientDeps {
  socketPath: string;
  protoRoot: string;
}

interface GrpcPayerDaemonClient extends grpc.Client {
  createPayment(
    req: {
      recipient: Buffer;
      ticketParamsBaseUrl: string;
      acceptedPrice: {
        pricePerUnitWei: { value: Buffer };
        unitsPerPrice: number;
        workUnitName: string;
        capability: string;
        offering: string;
        quoteRef: {
          quoteId: string;
          quoteVersion: number;
          constraintFingerprint: Uint8Array;
          routeFingerprint: Uint8Array;
        };
      };
      funding: {
        estimatedUnits: number;
        fundedValueWei: { value: Buffer };
        maxTotalUnits: number;
        topUpAllowed: boolean;
      };
    },
    cb: (
      err: grpc.ServiceError | null,
      resp: { paymentBytes: Buffer },
    ) => void,
  ): void;
  health(
    req: Record<string, never>,
    cb: (err: grpc.ServiceError | null, resp: { status: string }) => void,
  ): void;
}

interface PayerDaemonProto {
  livepeer: { payments: { v1: { PayerDaemon: grpc.ServiceClientConstructor } } };
}

export async function createUnixSocketPayerDaemonClient(
  deps: PayerDaemonClientDeps,
): Promise<PayerDaemonClient> {
  const def = await protoLoader.load(PROTO_FILES, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [deps.protoRoot],
  });
  const proto = grpc.loadPackageDefinition(def) as unknown as PayerDaemonProto;
  const ClientCtor = proto.livepeer.payments.v1.PayerDaemon;
  const client = new ClientCtor(
    `unix:${deps.socketPath}`,
    grpc.credentials.createInsecure(),
  ) as unknown as GrpcPayerDaemonClient;

  await new Promise<void>((resolve, reject) => {
    client.health({}, (err) => (err ? reject(err) : resolve()));
  });

  return {
    async createPayment(req) {
      const resp = await new Promise<{ paymentBytes: Buffer }>((resolve, reject) => {
        client.createPayment(
          {
            recipient: hexToBuffer(req.recipientEthAddress),
            ticketParamsBaseUrl: req.ticketParamsBaseUrl,
            acceptedPrice: {
              pricePerUnitWei: { value: bigintToBigEndian(BigInt(req.acceptedPrice.pricePerUnitWei)) },
              unitsPerPrice: requireSafeInteger(
                "accepted_price.units_per_price",
                req.acceptedPrice.unitsPerPrice,
              ),
              workUnitName: req.acceptedPrice.workUnitName,
              capability: req.acceptedPrice.capability,
              offering: req.acceptedPrice.offering,
              quoteRef: {
                quoteId: req.acceptedPrice.quoteRef.quoteId,
                quoteVersion: requireSafeInteger(
                  "accepted_price.quote_ref.quote_version",
                  req.acceptedPrice.quoteRef.quoteVersion,
                ),
                constraintFingerprint: req.acceptedPrice.quoteRef.constraintFingerprint,
                routeFingerprint: req.acceptedPrice.quoteRef.routeFingerprint,
              },
            },
            funding: {
              estimatedUnits: requireSafeInteger(
                "funding.estimated_units",
                req.funding.estimatedUnits,
              ),
              fundedValueWei: { value: bigintToBigEndian(BigInt(req.funding.fundedValueWei)) },
              maxTotalUnits: requireSafeInteger(
                "funding.max_total_units",
                req.funding.maxTotalUnits,
              ),
              topUpAllowed: req.funding.topUpAllowed ?? false,
            },
          },
          (err, result) => (err ? reject(err) : resolve(result)),
        );
      });

      return {
        paymentHeader: Buffer.from(resp.paymentBytes).toString("base64"),
      };
    },

    async close() {
      client.close();
    },
  };
}

function bigintToBigEndian(n: bigint): Buffer {
  if (n === 0n) return Buffer.alloc(0);
  const bytes: number[] = [];
  let v = n;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Buffer.from(bytes);
}

function hexToBuffer(hex: string): Buffer {
  const normalized = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`invalid recipient hex address: ${hex}`);
  }
  return Buffer.from(normalized, "hex");
}

function requireSafeInteger(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}
