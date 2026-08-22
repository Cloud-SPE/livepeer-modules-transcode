import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  createOperationSecretCipher,
  decodeWrappingKey,
} from "../../src/livepeer/operationSecrets.js";

test("operation secrets use a random data key and round-trip only for their operation", () => {
  const cipher = createOperationSecretCipher("test-key", randomBytes(32));
  const secrets = {
    runnerIngestUrl: "rtmp://private.example/live",
    runnerIngestKey: "runner-secret-value",
    grants: { stream_key_issue: "grant-secret-value" },
  };

  const first = cipher.encrypt("op-a", secrets);
  const second = cipher.encrypt("op-a", secrets);

  assert.deepEqual(cipher.decrypt("op-a", first), secrets);
  assert.notDeepEqual(first.wrappedKey, second.wrappedKey);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
  assert.equal(first.ciphertext.includes(Buffer.from("runner-secret-value")), false);
  assert.throws(() => cipher.decrypt("op-b", first));
});

test("operation secret authentication rejects modified ciphertext", () => {
  const cipher = createOperationSecretCipher("test-key", randomBytes(32));
  const encrypted = cipher.encrypt("op-a", { runnerIngestKey: "secret" });
  encrypted.ciphertext[0] = encrypted.ciphertext[0]! ^ 1;
  assert.throws(() => cipher.decrypt("op-a", encrypted));
});

test("wrapping key decoder requires canonical base64 for 32 bytes", () => {
  const encoded = randomBytes(32).toString("base64");
  assert.deepEqual(decodeWrappingKey(encoded).toString("base64"), encoded);
  assert.throws(() => decodeWrappingKey(randomBytes(31).toString("base64")));
  assert.throws(() => decodeWrappingKey("not-base64"));
});
