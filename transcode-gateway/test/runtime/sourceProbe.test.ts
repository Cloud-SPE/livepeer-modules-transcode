import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceProbeError } from "../../src/engine/interfaces/index.js";
import { createSourceProbe } from "../../src/runtime/sourceProbe.js";

test("local source probe parses fractional frame rate and video/audio metadata", async () => {
  let seenArgs: string[] = [];
  const probe = createSourceProbe({
    timeoutMs: 10_000,
    async run(_binary, args) {
      seenArgs = args;
      return JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" },
          { codec_type: "audio", codec_name: "aac" },
        ],
        format: { duration: "12.345" },
      });
    },
  });
  const result = await probe.probe("https://storage.example/source.mp4?signature=secret");
  assert.equal(result.durationSec, 12.345);
  assert.equal(result.frameRate, 30000 / 1001);
  assert.equal(result.audioCodec, "aac");
  assert.equal(seenArgs.at(-1), "https://storage.example/source.mp4?signature=secret");
});

test("malformed output and timeout errors are stable and never include source credentials", async () => {
  const malformed = createSourceProbe({ timeoutMs: 10, async run() { return "not-json"; } });
  await assert.rejects(
    () => malformed.probe("https://storage.example/source?signature=secret"),
    (error: unknown) => error instanceof SourceProbeError &&
      error.code === "source_probe_invalid" && !error.message.includes("secret"),
  );
  const timeout = createSourceProbe({
    timeoutMs: 10,
    async run() {
      const error = new Error("https://storage.example/source?signature=secret") as Error & { killed: boolean };
      error.killed = true;
      throw error;
    },
  });
  await assert.rejects(
    () => timeout.probe("https://storage.example/source?signature=secret"),
    (error: unknown) => error instanceof SourceProbeError &&
      error.code === "source_probe_timeout" && error.retryable && !error.message.includes("secret"),
  );
});
