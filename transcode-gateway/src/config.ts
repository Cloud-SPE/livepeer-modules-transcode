import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(16, "ADMIN_TOKEN must be at least 16 characters"),
  API_KEY_HASH_PEPPER: z.string().min(16, "API_KEY_HASH_PEPPER must be at least 16 characters"),
  IP_HASH_PEPPER: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(48),
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().default("Livepeer Transcode <noreply@example.com>"),
  BASE_URL: z.string().url().default("http://localhost:4000"),
  PORTAL_URL: z.string().url().default("http://localhost:3002"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ALLOWED_ORIGINS: z.string().default("*"),

  // Wire layer (plan 0004). All optional; when unset, stubs are used and
  // dispatch fails loudly. Resolver-only — no static LIVEPEER_BROKER_URL.
  LIVEPEER_RESOLVER_SOCKET: z.string().optional(),
  LIVEPEER_RESOLVER_PROTO_ROOT: z.string().default("./proto"),
  LIVEPEER_RESOLVER_SNAPSHOT_TTL_MS: z.coerce.number().int().positive().default(15_000),
  LIVEPEER_PAYER_SOCKET: z.string().optional(),
  LIVEPEER_PAYER_PROTO_ROOT: z.string().default("./proto"),
  LIVEPEER_ROUTE_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  LIVEPEER_ROUTE_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  LIVEPEER_FUNDED_VALUE_WEI: z.string().optional(),
  LIVEPEER_FACE_VALUE_WEI: z.string().optional(),
  LIVEPEER_VOD_OFFERING_DEFAULT: z.string().default("default"),
  // Required by v2 live paths before they may persist session credentials.
  // Canonical base64 for a 32-byte wrapping key held outside Postgres.
  LIVEPEER_OPERATION_SECRETS_KEK: z.string().optional(),
  LIVEPEER_OPERATION_SECRETS_KEY_ID: z.string().min(1).default("local-v1"),
  LIVEPEER_LOC_URL: z.string().url().optional(),
  LIVEPEER_LOC_API_KEY: z.string().min(1).optional(),
  LIVEPEER_LOC_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  LIVEPEER_LOC_CLIENT_ID: z
    .string()
    .min(1)
    .default("livepeer-modules-transcode/0.0.0"),

  // VOD storage (plan 0005). All optional; routes return 503 s3_not_configured
  // when unset.
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  VOD_UPLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(3600),
  VOD_PLAYBACK_URL_TTL_SEC: z.coerce.number().int().positive().default(3600),
  VOD_SOURCE_PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  VOD_FFPROBE_BIN: z.string().min(1).default("ffprobe"),

  // Gateway RTMP listener (plan 0007). All optional; when
  // LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL is unset the listener does not bind
  // and the live route returns the broker's RTMP URL (plan 0006 default).
  RTMP_LISTEN_PORT: z.coerce.number().int().positive().default(1935),
  RTMP_LISTEN_HOST: z.string().default("0.0.0.0"),
  LIVEPEER_GATEWAY_EXTERNAL_RTMP_URL: z.string().optional(),
  RTMP_RELAY_ENABLED: z.coerce.boolean().default(true),
  RTMP_RELAY_FFMPEG_BIN: z.string().default("ffmpeg"),
}).superRefine((value, context) => {
  if (Boolean(value.LIVEPEER_LOC_URL) !== Boolean(value.LIVEPEER_LOC_API_KEY)) {
    context.addIssue({
      code: "custom",
      path: [value.LIVEPEER_LOC_URL ? "LIVEPEER_LOC_API_KEY" : "LIVEPEER_LOC_URL"],
      message: "LIVEPEER_LOC_URL and LIVEPEER_LOC_API_KEY must be set together",
    });
  }
});

type ParsedConfig = z.infer<typeof envSchema>;

export type Config = Readonly<
  Omit<ParsedConfig, "LIVEPEER_FUNDED_VALUE_WEI"> & {
    LIVEPEER_FUNDED_VALUE_WEI: string;
  }
>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const fundedValueWei =
    parsed.data.LIVEPEER_FUNDED_VALUE_WEI ??
    parsed.data.LIVEPEER_FACE_VALUE_WEI ??
    "1000000000000000";
  return Object.freeze({
    ...parsed.data,
    LIVEPEER_FUNDED_VALUE_WEI: fundedValueWei,
  });
}

export function emailEnabled(config: Config): boolean {
  return Boolean(config.RESEND_API_KEY && config.RESEND_API_KEY.length > 0);
}
