// Modeled on livepeer-network-modules/video-gateway/src/engine/interfaces/streamKeyHasher.ts.
// Used by live RTMP in plan 0006; the interface lands here so the engine boundary is stable.

export interface StreamKeyHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, encoded: string): Promise<boolean>;
}
