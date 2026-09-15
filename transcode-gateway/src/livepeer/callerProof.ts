import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const PRIVATE_KEY = /^[0-9a-f]{64}$/;
const PROOF_DOMAIN = new TextEncoder().encode("livepeer-invocation-proof/v1\0");
const PERSONAL_SIGN_PREFIX = new TextEncoder().encode("\x19Ethereum Signed Message:\n32");

export interface CallerProofIdentity {
  publicKey: string;
  signAuthorization(authorization: string): string;
}

export function createCallerProofIdentity(privateKeyHex: string): CallerProofIdentity {
  if (!PRIVATE_KEY.test(privateKeyHex)) {
    throw new Error("LIVEPEER_CALLER_PRIVATE_KEY must be 64 lowercase hex characters");
  }
  const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, "hex"));
  if (!secp256k1.utils.isValidSecretKey(privateKey)) {
    throw new Error("LIVEPEER_CALLER_PRIVATE_KEY is not a valid secp256k1 private key");
  }
  const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true)).toString("hex");
  return Object.freeze({
    publicKey,
    signAuthorization(authorization: string) {
      const authorizationBytes = decodeCanonicalBase64(authorization);
      const invocationDigest = keccak_256(concat(PROOF_DOMAIN, authorizationBytes));
      const personalDigest = keccak_256(concat(PERSONAL_SIGN_PREFIX, invocationDigest));
      const recovered = secp256k1.sign(personalDigest, privateKey, {
        format: "recovered",
        prehash: false,
        lowS: true,
      });
      const wire = new Uint8Array(65);
      wire.set(recovered.subarray(1), 0);
      wire[64] = recovered[0]! + 27;
      return Buffer.from(wire).toString("base64");
    },
  });
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("LOC spend_authorization is not canonical base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("LOC spend_authorization is not canonical base64");
  }
  return Uint8Array.from(decoded);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
