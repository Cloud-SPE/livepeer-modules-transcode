import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { PaidOperationSecrets } from "../engine/types/index.js";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedOperationSecrets {
  keyId: string;
  wrappedKey: Buffer;
  wrappedKeyIv: Buffer;
  wrappedKeyTag: Buffer;
  ciphertext: Buffer;
  payloadIv: Buffer;
  payloadTag: Buffer;
}

export interface OperationSecretCipher {
  encrypt(operationId: string, value: PaidOperationSecrets): EncryptedOperationSecrets;
  decrypt(operationId: string, value: EncryptedOperationSecrets): PaidOperationSecrets;
}

function seal(key: Buffer, plaintext: Buffer, iv: Buffer, aad: Buffer): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  return {
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
    tag: cipher.getAuthTag(),
  };
}

function open(key: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function decodeWrappingKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) {
    throw new Error("LIVEPEER_OPERATION_SECRETS_KEK must be canonical base64 for exactly 32 bytes");
  }
  return key;
}

export function createOperationSecretCipher(keyId: string, wrappingKey: Buffer): OperationSecretCipher {
  if (keyId.length === 0) throw new Error("operation secret key ID must not be empty");
  if (wrappingKey.length !== KEY_BYTES) throw new Error("operation secret wrapping key must be 32 bytes");
  const kek = Buffer.from(wrappingKey);

  return {
    encrypt(operationId, value) {
      const dataKey = randomBytes(KEY_BYTES);
      const wrappedKeyIv = randomBytes(IV_BYTES);
      const payloadIv = randomBytes(IV_BYTES);
      const wrapAad = Buffer.from(`paid-operation:${operationId}:dek:${keyId}`);
      const payloadAad = Buffer.from(`paid-operation:${operationId}:payload:${keyId}`);
      const wrapped = seal(kek, dataKey, wrappedKeyIv, wrapAad);
      const payload = seal(dataKey, Buffer.from(JSON.stringify(value), "utf8"), payloadIv, payloadAad);
      dataKey.fill(0);
      return {
        keyId,
        wrappedKey: wrapped.ciphertext,
        wrappedKeyIv,
        wrappedKeyTag: wrapped.tag,
        ciphertext: payload.ciphertext,
        payloadIv,
        payloadTag: payload.tag,
      };
    },

    decrypt(operationId, value) {
      if (value.keyId !== keyId) throw new Error("operation secret key is unavailable");
      const wrapAad = Buffer.from(`paid-operation:${operationId}:dek:${keyId}`);
      const payloadAad = Buffer.from(`paid-operation:${operationId}:payload:${keyId}`);
      const dataKey = open(kek, value.wrappedKey, value.wrappedKeyIv, value.wrappedKeyTag, wrapAad);
      try {
        const plaintext = open(dataKey, value.ciphertext, value.payloadIv, value.payloadTag, payloadAad);
        const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("decrypted operation secrets are not an object");
        }
        return parsed as PaidOperationSecrets;
      } finally {
        dataKey.fill(0);
      }
    },
  };
}
