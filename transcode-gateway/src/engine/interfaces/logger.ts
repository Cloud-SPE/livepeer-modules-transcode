// Modeled on livepeer-network-modules/video-gateway/src/engine/interfaces/logger.ts.

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown> | Error): void;
}
