import http from "node:http";

const port = Number(process.env.BROKER_PORT ?? "8080");

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    res.end("ok");
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const payment = req.headers["livepeer-payment"];
    if (!payment) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "error", error: "payment_missing" }));
      return;
    }

    if (req.url === "/v1/video/transcode/probe") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          durationSec: 1.25,
          width: 1280,
          height: 720,
          frameRate: 30,
          audioCodec: "aac",
          videoCodec: "h264",
          raw: { mock: true },
        }),
      );
      return;
    }

    if (req.url === "/v1/video/transcode") {
      const parsed = JSON.parse(body || "{}");
      const outputPrefix = typeof parsed.output_prefix === "string" ? parsed.output_prefix : "mock-output/";
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          storageKey: `${outputPrefix}index.m3u8`,
          durationSec: 1.25,
          segmentCount: 1,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "error", error: "unknown_path", path: req.url }));
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", msg: "mock.broker.listening", port }));
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
