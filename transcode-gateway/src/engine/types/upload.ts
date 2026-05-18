// Modeled on livepeer-network-modules/video-gateway/src/engine/types/upload.ts.
// projectId → apiKeyId.

export interface Upload {
  id: string;
  apiKeyId: string;
  assetId?: string;
  status: UploadStatus;
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
  createdAt: Date;
  completedAt?: Date;
}

export type UploadStatus = "waiting" | "uploading" | "completed" | "expired";
