import "server-only";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

/** Configured once per process from CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/
 * CLOUDINARY_API_SECRET — see DEPLOYMENT.md's environment variables table.
 * Product media (src/lib/uploads.ts) is the only thing that uses this. */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export type CloudinaryResourceType = "image" | "video";

const UPLOAD_FOLDER = "ovi-mobile/products";

/** Uploads an already-validated/processed buffer (see saveUploadedProductFile
 * in src/lib/uploads.ts) via Cloudinary's upload_stream, so no temp file is
 * ever written to disk. */
export function uploadBufferToCloudinary(
  buffer: Buffer,
  options: { resourceType: CloudinaryResourceType; format: string },
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: options.resourceType,
        folder: UPLOAD_FOLDER,
        format: options.format,
      },
      (error: unknown, result?: UploadApiResponse) => {
        if (error || !result) {
          // Cloudinary's SDK rejects with a plain { message, name, http_code }
          // object, not a real Error instance — extract .message explicitly
          // instead of losing it behind a generic string.
          const message =
            error && typeof error === "object" && "message" in error
              ? String((error as { message: unknown }).message)
              : error
                ? String(error)
                : "Cloudinary upload returned no result";
          reject(new Error(message));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Deletes a previously uploaded asset by its public_id. Resource type must
 * match what it was uploaded as — Cloudinary's destroy API scopes lookups by
 * resource_type, so passing the wrong one silently no-ops instead of erroring. */
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: CloudinaryResourceType,
): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
