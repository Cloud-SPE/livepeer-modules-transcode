import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import fs from "node:fs";

const socketPath = process.env.PAYER_SOCKET ?? "/var/run/livepeer/payer.sock";
const protoRoot = process.env.PROTO_ROOT ?? "/app/transcode-gateway/proto";
const protoFile = `${protoRoot}/livepeer/payments/v1/payer_daemon.proto`;

fs.rmSync(socketPath, { force: true });

const def = await protoLoader.load(protoFile, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [protoRoot],
});
const pkg = grpc.loadPackageDefinition(def);
const svc = pkg.livepeer.payments.v1.PayerDaemon;

const server = new grpc.Server();
server.addService(svc.service, {
  health(_call, callback) {
    callback(null, { status: "ok" });
  },
  createPayment(call, callback) {
    const req = call.request;
    if (!req.ticketParamsBaseUrl || !req.acceptedPrice?.quoteRef?.quoteId) {
      callback(new Error("mock payer received malformed CreatePayment request"));
      return;
    }
    callback(null, {
      paymentBytes: Buffer.from("mock-payment"),
      ticketsCreated: 1,
      expectedValue: { value: Buffer.from([1]) },
      fundedValueWei: req.funding?.fundedValueWei ?? { value: Buffer.alloc(0) },
      acceptedQuoteRef: req.acceptedPrice.quoteRef,
    });
  },
  getDepositInfo(_call, callback) {
    callback(null, { deposit: Buffer.alloc(0), reserve: Buffer.alloc(0), withdrawRound: 0 });
  },
  getSessionDebits(_call, callback) {
    callback(null, { totalWorkUnits: 0, debitCount: 0, closed: false });
  },
});

server.bindAsync(`unix:${socketPath}`, grpc.ServerCredentials.createInsecure(), (err) => {
  if (err) throw err;
  console.log(JSON.stringify({ level: "info", msg: "mock.payer.listening", socket: socketPath }));
});

process.on("SIGTERM", () => server.tryShutdown(() => process.exit(0)));
process.on("SIGINT", () => server.tryShutdown(() => process.exit(0)));
