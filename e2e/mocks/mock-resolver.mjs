import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import fs from "node:fs";

const socketPath = process.env.RESOLVER_SOCKET ?? "/var/run/livepeer/resolver.sock";
const brokerUrl = process.env.BROKER_URL ?? "http://mock-broker:8080";
const protoRoot = process.env.PROTO_ROOT ?? "/app/transcode-gateway/proto";
const protoFile = `${protoRoot}/livepeer/registry/v1/resolver.proto`;

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
const svc = pkg.livepeer.registry.v1.Resolver;

const server = new grpc.Server();
server.addService(svc.service, {
  selectMany(call, callback) {
    const capability = call.request.capability;
    const offering = call.request.offering || "default";
    callback(null, {
      routes: [
        {
          workerUrl: brokerUrl,
          ethAddress: "0x1234567890abcdef1234567890abcdef12345678",
          capability,
          offering,
          pricePerWorkUnitWei: "2500",
          workUnit: "seconds",
          extraJson: Buffer.from(JSON.stringify({ video: { modes: ["vod", "live"] } })),
          constraintsJson: Buffer.from(JSON.stringify({ region: "test" })),
          quoteId: `mock:${capability}:${offering}`,
          quoteVersion: 1,
          constraintFingerprint: Buffer.from([1, 2, 3]),
          routeFingerprint: Buffer.from([4, 5, 6]),
          unitsPerPrice: 1,
        },
      ],
    });
  },
  listKnown(_call, callback) {
    callback(null, { entries: [] });
  },
  resolveByAddress(_call, callback) {
    callback(null, { nodes: [] });
  },
  health(_call, callback) {
    callback(null, {
      mode: "mock",
      chainOk: true,
      manifestFetcherOk: true,
      cacheSize: 1,
    });
  },
});

server.bindAsync(`unix:${socketPath}`, grpc.ServerCredentials.createInsecure(), (err) => {
  if (err) throw err;
  console.log(JSON.stringify({ level: "info", msg: "mock.resolver.listening", socket: socketPath, brokerUrl }));
});

process.on("SIGTERM", () => server.tryShutdown(() => process.exit(0)));
process.on("SIGINT", () => server.tryShutdown(() => process.exit(0)));
