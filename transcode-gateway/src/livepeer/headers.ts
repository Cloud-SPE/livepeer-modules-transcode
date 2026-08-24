// Modeled on livepeer-network-modules/video-gateway/src/livepeer/headers.ts.

export const HEADER = {
  CAPABILITY:   "Livepeer-Capability",
  OFFERING:     "Livepeer-Offering",
  PAYMENT:      "Livepeer-Payment",
  PROTOCOL:     "Livepeer-Protocol",
  SPEC_VERSION: "Livepeer-Spec-Version",
  MODE:         "Livepeer-Mode",
  REQUEST_ID:   "Livepeer-Request-Id",
  BACKOFF:      "Livepeer-Backoff",
  WORK_UNITS:   "Livepeer-Work-Units",
  WORK_UNIT:    "Livepeer-Work-Unit",
  JOB_ID:       "Livepeer-Job-Id",
  REBIND_FROM:  "Livepeer-Rebind-From",
  SETTLEMENT:   "Livepeer-Settlement",
  ERROR:        "Livepeer-Error",
} as const;

export const SPEC_VERSION = "0.1";
