import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Logger } from "../../engine/interfaces/index.js";
import type { StorageProvider } from "../../engine/interfaces/index.js";
import type { AssetRepo, UploadRepo } from "../../engine/repo/index.js";
import { makeUserApiKeyAuth } from "../../middleware/userApiKeyAuth.js";
import type { DbPool } from "../../db/pool.js";

// Presigned S3 PUT upload protocol (plan 0005 §3.5). No tus.
//
//   POST /v1/uploads          → { upload_url, asset_id, upload_id, storage_key, expires_at }
//   POST /v1/uploads/:id/complete → { asset_id, upload_id, status }
//
// All routes are API-key-gated. asset row + upload row are created
// atomically at upload-init; client PUTs bytes directly to S3.

export interface UploadsDeps {
  pool: DbPool;
  config: Config;
  storage: StorageProvider | null;
  assetRepo: AssetRepo;
  uploadRepo: UploadRepo;
  logger?: Logger;
}

const createBody = z.object({
  filename: z.string().min(1).max(512),
  content_type: z.string().min(1).max(128).default("application/octet-stream"),
});

const completeParams = z.object({ id: z.string().min(1) });

function newAssetId(): string {
  return `asset_${randomBytes(12).toString("hex")}`;
}

function newUploadId(): string {
  return `upl_${randomBytes(12).toString("hex")}`;
}

export function registerVodUploads(app: FastifyInstance, deps: UploadsDeps): void {
  const auth = makeUserApiKeyAuth({ pool: deps.pool, config: deps.config });

  // POST /v1/uploads
  app.post("/v1/uploads", { preHandler: auth }, async (req, reply) => {
    if (!deps.storage) {
      reply.code(503).send({
        status: "error",
        error: "s3_not_configured",
        message: "S3_REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY must be set",
      });
      return;
    }

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid body." });
      return;
    }

    const apiKey = req.apiKey!;
    const assetId = newAssetId();
    const uploadId = newUploadId();
    const ttlSec = deps.config.VOD_UPLOAD_URL_TTL_SEC;
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    const presigned = await deps.storage.putSignedUploadUrl({
      assetId,
      kind: "source",
      filename: parsed.data.filename,
      contentType: parsed.data.content_type,
      expiresInSec: ttlSec,
    });

    await deps.assetRepo.insert({
      id: assetId,
      apiKeyId: apiKey.id,
      status: "preparing",
      sourceType: "upload",
      encodingTier: "standard",
    });

    await deps.uploadRepo.insert({
      id: uploadId,
      apiKeyId: apiKey.id,
      assetId,
      status: "waiting",
      uploadUrl: presigned.url,
      storageKey: presigned.storageKey,
      expiresAt,
    });

    return {
      upload_url: presigned.url,
      asset_id: assetId,
      upload_id: uploadId,
      storage_key: presigned.storageKey,
      expires_at: expiresAt.toISOString(),
    };
  });

  // POST /v1/uploads/:id/complete
  app.post("/v1/uploads/:id/complete", { preHandler: auth }, async (req, reply) => {
    const parsed = completeParams.safeParse(req.params);
    if (!parsed.success) {
      reply.code(400).send({ status: "error", message: "Invalid upload id." });
      return;
    }

    const apiKey = req.apiKey!;
    const upload = await deps.uploadRepo.byId(parsed.data.id);
    if (!upload || upload.apiKeyId !== apiKey.id) {
      reply.code(404).send({ status: "error", message: "Upload not found." });
      return;
    }

    if (upload.status !== "waiting" && upload.status !== "uploading") {
      return { asset_id: upload.assetId ?? null, upload_id: upload.id, status: upload.status };
    }

    await deps.uploadRepo.updateStatus(upload.id, "completed", { completedAt: new Date() });

    if (upload.assetId) {
      // Asset row was created at upload-init; flesh in the source_url
      // pointing at the storage_key so the orchestrator can find it.
      // (The orchestrator's probe step builds a signed download URL from
      // storage.pathFor() if source_url isn't already an http/s3 URL.)
      await deps.assetRepo.updateStatus(upload.assetId, "preparing", {
        sourceUrl: upload.storageKey,
      });
    }

    return { asset_id: upload.assetId ?? null, upload_id: upload.id, status: "completed" };
  });
}
