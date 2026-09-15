// Modeled on livepeer-network-modules/video-gateway/src/livepeer/headers.ts.

export const HEADER = {
  CAPABILITY:   "Livepeer-Capability",
  OFFERING:     "Livepeer-Offering",
  PAYMENT:      "Livepeer-Payment",
  AUTHORIZATION:"Livepeer-Authorization",
  CALLER_PROOF: "Livepeer-Caller-Proof",
  PROTOCOL:     "Livepeer-Protocol",
  REQUEST_ID:   "Livepeer-Request-Id",
  BACKOFF:      "Livepeer-Backoff",
  WORK_UNITS:   "Livepeer-Work-Units",
  WORK_UNIT:    "Livepeer-Work-Unit",
  JOB_ID:       "Livepeer-Job-Id",
  REBIND_FROM:  "Livepeer-Rebind-From",
  SETTLEMENT:   "Livepeer-Settlement",
  ERROR:        "Livepeer-Error",
} as const;
