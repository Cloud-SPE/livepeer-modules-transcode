// Minimal ambient declaration for node-media-server v4. The package ships
// JSDoc comments but no .d.ts; we only need the constructor + .on/.run +
// the internal `rtmpServer.tcpServer.close()` path we use for teardown.

declare module "node-media-server" {
  export interface NmsConfig {
    bind?: string;
    rtmp?: { port: number };
    rtmps?: { port: number; key: string; cert: string };
    http?: { port: number };
  }

  export default class NodeMediaServer {
    constructor(config: NmsConfig);
    on(event: string, listener: (session: unknown) => void): void;
    run(): void;
    rtmpServer?: { tcpServer?: { close(cb?: () => void): void } };
  }
}
