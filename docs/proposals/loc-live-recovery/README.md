# LOC preparation recovery proposal — not deployed

The production incident involved registry chain RPC circuit failures followed
by an uncaught gRPC NOT_FOUND in LOC SelectMany. The preparation handler had
already committed its idempotency claim; production's in-flight timeout is
300 seconds. Replays returned IDEMPOTENCY_IN_PROGRESS until reclaim succeeded.

`loc-preparation.patch` is against the read-only sibling LOC checkout. It was
applied only to an isolated copy under `/tmp/lmt-loc-review`. Neither the source
checkout nor production has been modified.

The patch gives SelectMany a 10-second deadline, maps NOT_FOUND to an empty
selection, and maps other gRPC failures to a sanitized DAEMON_UNAVAILABLE. On a
known preparation failure it expires only that preparation's in-flight claim,
preserving its fingerprint and request identity for retry. Preparation does not
fund or authorize a workload. Paid opens, refills and unknown payment outcomes
retain their existing safety rules.

Four targeted regression checks are in `test_preparation_recovery.py`; run them
with the patched package on PYTHONPATH and LOC's Python dependencies installed.
The patch does not fix RPC availability or the broker's pending winddown.
Deploying it would require explicit approval, a gateway image rebuild and a
controlled replacement of the LOC gateway container, with the existing database
and runtime secrets preserved. No migration or data reset is proposed.

Validation: four targeted proposal tests passed. Existing LOC registry cache,
registry gRPC mapping, create-idempotency, and session service suites against the
isolated package passed 35 tests; 11 existing legacy ticket tests were skipped.
These are local tests, not evidence of a production deployment.

## Review revision

Review found the initial release helper lacked an attempt fence: a delayed
failure could release a newer in-flight preparation. The revised patch carries
the original claim expiry and releases only a row whose status and expiry still
match that attempt. An in-memory database regression covers current, renewed,
and completed claims. Four targeted and35 existing tests still pass;11 legacy
cases remain skipped. No paid-operation rows are reset or deleted.

The fixed 10-second registry deadline bounds failure latency; it does not make a
failing chain RPC healthy. Validate it against normal production cold-selection
latency before deployment. The user selected review first; this proposal is not
authorization to modify production.
