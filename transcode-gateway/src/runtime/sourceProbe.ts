import { execFile } from "node:child_process";
import { z } from "zod";
import type { SourceProbe } from "../engine/interfaces/index.js";
import { SourceProbeError } from "../engine/interfaces/index.js";

const probeWire = z.object({
  streams: z.array(z.object({
    codec_type: z.enum(["video", "audio"]),
    codec_name: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    avg_frame_rate: z.string().optional(),
  }).passthrough()),
  format: z.object({ duration: z.string().min(1) }).passthrough(),
}).passthrough();

export interface SourceProbeOptions {
  ffprobeBin?: string;
  timeoutMs: number;
  run?: (binary: string, args: string[], timeoutMs: number) => Promise<string>;
}

export function createSourceProbe(options: SourceProbeOptions): SourceProbe {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("source probe timeout is invalid");
  }
  const binary = options.ffprobeBin ?? "ffprobe";
  const run = options.run ?? runFfprobe;
  return {
    async probe(inputUrl) {
      if (!validInputUrl(inputUrl)) throw new SourceProbeError("source_probe_invalid", false);
      let stdout: string;
      try {
        stdout = await run(binary, [
          "-v", "error",
          "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate",
          "-of", "json",
          inputUrl,
        ], options.timeoutMs);
      } catch (error) {
        const timedOut = isTimeout(error);
        throw new SourceProbeError(timedOut ? "source_probe_timeout" : "source_probe_failed", true);
      }
      try {
        const parsed = probeWire.parse(JSON.parse(stdout));
        const video = parsed.streams.find((stream) => stream.codec_type === "video");
        const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
        if (!video?.width || !video.height || !video.avg_frame_rate) throw new Error("missing video");
        const durationSec = Number(parsed.format.duration);
        const frameRate = rational(video.avg_frame_rate);
        if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(frameRate) || frameRate <= 0) {
          throw new Error("invalid timing");
        }
        return {
          durationSec,
          width: video.width,
          height: video.height,
          frameRate,
          audioCodec: audio?.codec_name ?? "none",
          videoCodec: video.codec_name,
          raw: parsed,
        };
      } catch {
        throw new SourceProbeError("source_probe_invalid", false);
      }
    },
  };
}

function runFfprobe(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 1_048_576 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function rational(value: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return Number(value);
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return denominator === 0 ? NaN : numerator / denominator;
}

function validInputUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error &&
    ("killed" in error && error.killed === true || "code" in error && error.code === "ETIMEDOUT");
}
