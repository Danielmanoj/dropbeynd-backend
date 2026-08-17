import { v2 as cloudinary } from "cloudinary";

let configured = false;

export function isCloudinaryConfigured(): boolean {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function ensureConfigured(): void {
  if (configured) return;
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export type CloudinaryResourceType = "image" | "video" | "raw";

export interface SignedUploadParams {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  resourceType: CloudinaryResourceType;
}

/**
 * Generate a signature for a direct-to-Cloudinary browser upload.
 * The browser POSTs the file + these fields to Cloudinary's own API —
 * the file never passes through our server, avoiding upload-size limits.
 */
export function generateSignedUploadParams(folder: string, resourceType: CloudinaryResourceType): SignedUploadParams {
  ensureConfigured();
  const timestamp = Math.round(Date.now() / 1000);
  const paramsToSign = { folder, timestamp };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET!);
  return {
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    folder,
    resourceType,
  };
}

/**
 * Ingest a remote media URL into Cloudinary (used for migrating legacy/seed
 * media that currently lives on unreliable third-party hosts).
 */
export async function uploadRemoteUrlToCloudinary(
  remoteUrl: string,
  folder: string,
  resourceType: CloudinaryResourceType,
): Promise<{ secureUrl: string; publicId: string }> {
  ensureConfigured();
  const result = await cloudinary.uploader.upload(remoteUrl, {
    folder,
    resource_type: resourceType,
  });
  return { secureUrl: result.secure_url, publicId: result.public_id };
}

/** Delete a Cloudinary asset by its public_id (used for cleanup / replace flows). */
export async function deleteCloudinaryAsset(publicId: string, resourceType: CloudinaryResourceType): Promise<void> {
  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
