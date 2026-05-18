import {
  pgSchema,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────
// auth.*  — landed by plan 0002
// ─────────────────────────────────────────────────────────────────

export const auth = pgSchema("auth");

export const waitlist = auth.table(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    ipHash: text("ip_hash"),
    status: text("status").notNull().default("pending"),
    emailVerified: boolean("email_verified").notNull().default(false),
    verificationToken: text("verification_token"),
    verificationTokenExpiresAt: timestamp("verification_token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  },
  (t) => [index("waitlist_status_created").on(t.status, t.createdAt)],
);

export const users = auth.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  waitlistId: uuid("waitlist_id").notNull().unique().references(() => waitlist.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = auth.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_hash").on(t.keyHash), index("api_keys_user").on(t.userId)],
);

export const sessions = auth.table("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  apiKeyId: uuid("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────
// media.* — landed by plan 0003
// ─────────────────────────────────────────────────────────────────

export const media = pgSchema("media");

export const assets = media.table(
  "assets",
  {
    id: text("id").primaryKey(),
    apiKeyId: uuid("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    sourceType: text("source_type").notNull(),
    selectedOffering: text("selected_offering"),
    sourceUrl: text("source_url"),
    durationSec: numeric("duration_sec", { precision: 12, scale: 3 }),
    width: integer("width"),
    height: integer("height"),
    frameRate: numeric("frame_rate", { precision: 6, scale: 3 }),
    audioCodec: text("audio_codec"),
    videoCodec: text("video_codec"),
    encodingTier: text("encoding_tier").notNull().default("standard"),
    ffprobeJson: jsonb("ffprobe_json"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("assets_api_key_created").on(t.apiKeyId, t.createdAt),
    index("assets_not_deleted").on(t.deletedAt),
  ],
);

export const uploads = media.table("uploads", {
  id: text("id").primaryKey(),
  apiKeyId: uuid("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "restrict" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  uploadUrl: text("upload_url").notNull(),
  storageKey: text("storage_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const renditions = media.table("renditions", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  resolution: text("resolution").notNull(),
  codec: text("codec").notNull(),
  bitrateKbps: integer("bitrate_kbps").notNull(),
  storageKey: text("storage_key"),
  status: text("status").notNull(),
  durationSec: numeric("duration_sec", { precision: 12, scale: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const encodingJobs = media.table(
  "encoding_jobs",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    renditionId: text("rendition_id").references(() => renditions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    workerUrl: text("worker_url"),
    attemptCount: integer("attempt_count").notNull().default(0),
    inputUrl: text("input_url"),
    outputPrefix: text("output_prefix"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("encoding_jobs_status_created").on(t.status, t.createdAt)],
);

export const liveStreams = media.table("live_streams", {
  id: text("id").primaryKey(),
  apiKeyId: uuid("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "restrict" }),
  name: text("name"),
  streamKeyHash: text("stream_key_hash").notNull().unique(),
  status: text("status").notNull(),
  ingestProtocol: text("ingest_protocol").notNull().default("rtmp"),
  sessionId: text("session_id"),
  workerId: text("worker_id"),
  workerUrl: text("worker_url"),
  selectedCapability: text("selected_capability"),
  selectedOffering: text("selected_offering"),
  selectedWorkUnit: text("selected_work_unit"),
  selectedPricePerWorkUnitWei: text("selected_price_per_work_unit_wei"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const playbackIds = media.table("playback_ids", {
  id: text("id").primaryKey(),
  apiKeyId: uuid("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "restrict" }),
  assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  liveStreamId: text("live_stream_id").references(() => liveStreams.id, { onDelete: "cascade" }),
  policy: text("policy").notNull(),
  tokenRequired: boolean("token_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
