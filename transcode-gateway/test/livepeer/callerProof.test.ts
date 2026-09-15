import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createCallerProofIdentity } from "../../src/livepeer/callerProof.js";

test("caller proof uses the Modules recoverable EIP-191 wire contract", () => {
  const identity = createCallerProofIdentity("00".repeat(31) + "01");
  const authorization = Buffer.from("signed-authorization").toString("base64");
  const proof = Buffer.from(identity.signAuthorization(authorization), "base64");
  assert.equal(identity.publicKey, "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  assert.equal(proof.length, 65);
  assert.ok(proof[64] === 27 || proof[64] === 28);

  const domain = new TextEncoder().encode("livepeer-invocation-proof/v1\0");
  const invocation = keccak_256(Buffer.concat([domain, Buffer.from(authorization, "base64")]));
  const digest = keccak_256(Buffer.concat([
    new TextEncoder().encode("\x19Ethereum Signed Message:\n32"),
    invocation,
  ]));
  const recoveredWire = Buffer.concat([
    Buffer.from([proof[64]! - 27]),
    proof.subarray(0, 64),
  ]);
  assert.equal(
    Buffer.from(secp256k1.recoverPublicKey(recoveredWire, digest, { prehash: false })).toString("hex"),
    identity.publicKey,
  );
});

test("caller proof identity rejects invalid keys and authorization encoding", () => {
  assert.throws(() => createCallerProofIdentity("01"), /64 lowercase hex/);
  assert.throws(() => createCallerProofIdentity("00".repeat(32)), /valid secp256k1/);
  const identity = createCallerProofIdentity("00".repeat(31) + "01");
  assert.throws(() => identity.signAuthorization("not base64"), /canonical base64/);
});
