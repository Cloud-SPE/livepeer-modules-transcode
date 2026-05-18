// Modeled on livepeer-network-modules/video-gateway/src/livepeer/payerDaemonClient.ts.
// Source leaves UDS fetch as caller-supplied; we provide a real impl via
// undici's Agent({ connect: { socketPath } }).

import { Agent, fetch as undiciFetch } from "undici";

export interface CreatePaymentRequest {
  faceValueWei: string;
  recipientEthAddress: string;
  capability: string;
  offering: string;
  nodeId: string;
}

export interface CreatePaymentResponse {
  payerWorkId: string;
  paymentHeader: string;
}

export interface PayerDaemonClient {
  createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResponse>;
  close(): Promise<void>;
}

export interface PayerDaemonClientDeps {
  socketPath: string;
}

export function createUnixSocketPayerDaemonClient(deps: PayerDaemonClientDeps): PayerDaemonClient {
  const baseUrl = "http://payer-daemon.invalid";
  const agent = new Agent({ connect: { socketPath: deps.socketPath } });

  return {
    async createPayment(req) {
      const res = await undiciFetch(`${baseUrl}/v1/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          face_value_wei: req.faceValueWei,
          recipient_eth_address: req.recipientEthAddress,
          capability: req.capability,
          offering: req.offering,
          node_id: req.nodeId,
        }),
        dispatcher: agent,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`payerDaemon createPayment ${res.status}: ${body}`);
      }
      const body = (await res.json()) as {
        payer_work_id?: string;
        payment_header?: string;
      };
      if (!body.payer_work_id || !body.payment_header) {
        throw new Error("payerDaemon createPayment: malformed response");
      }
      return {
        payerWorkId: body.payer_work_id,
        paymentHeader: body.payment_header,
      };
    },

    async close() {
      await agent.close();
    },
  };
}
