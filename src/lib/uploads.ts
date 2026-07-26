import sharp from "sharp";
import convertHeic from "heic-convert";
import { HEIC_FAILURE_MESSAGE, type MediaValidationSuccess, type MediaType } from "@/lib/validation/productMedia";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";

/** Long-edge cap for any saved still image — never upscaled (sharp's
 * `withoutEnlargement`), aspect ratio always preserved. */
const MAX_IMAGE_DIMENSION_PX = 2400;
const WEBP_QUALITY = 85;
const HEIC_INTERMEDIATE_JPEG_QUALITY = 0.92;

const GENERIC_IMAGE_FAILURE_MESSAGE = "تعذر معالجة الصورة، يرجى المحاولة بملف آخر.";

export type SaveMediaResult =
  | { ok: true; url: string; cloudinaryPublicId: string }
  | { ok: false; error: string };

/**
 * Persists an already-validated media buffer (see validateMediaBuffer() in
 * src/lib/validation/productMedia.ts) to Cloudinary (src/lib/cloudinary.ts).
 *
 * Video passes through unchanged (existing pipeline, preserved as-is) —
 * only the storage destination changed, not the format.
 *
 * Every still-image format this app accepts (JPEG, PNG, WebP, HEIC/HEIF) is
 * standardized through one path: decode, auto-rotate from EXIF, cap the
 * long edge at MAX_IMAGE_DIMENSION_PX (never upscaled, aspect ratio kept),
 * re-encode as WebP, and metadata (EXIF/GPS/ICC beyond what's needed for
 * color) is dropped by not calling sharp's `.withMetadata()`. The uploaded
 * format is therefore always "webp" — decided from the real converted
 * output, never the original filename or declared MIME type.
 *
 * GIF is no longer an accepted upload format (validateMediaBuffer rejects
 * it before this function is ever called) — this function has no GIF path.
 * Existing GIF files/ProductImage rows from before this change are
 * untouched; only new uploads are affected.
 *
 * HEIC/HEIF specifically: sharp's bundled libvips build cannot decode HEIC
 * (verified — its heif input format only lists a ".avif" file suffix,
 * because prebuilt sharp/libvips binaries exclude HEIC decoding due to HEVC
 * licensing). heic-convert (backed by libheif-js, a WebAssembly build of
 * libheif with no native compile step) decodes the HEIC/HEIF file to a
 * JPEG buffer first, which is then handed to the same sharp pipeline as
 * every other image format.
 */
export async function saveUploadedProductFile(
  buffer: Buffer,
  validation: MediaValidationSuccess,
): Promise<SaveMediaResult> {
  if (validation.mediaType === "VIDEO") {
    const extension = validation.videoExtension ?? "mp4";
    try {
      const uploaded = await uploadBufferToCloudinary(buffer, { resourceType: "video", format: extension });
      return { ok: true, url: uploaded.url, cloudinaryPublicId: uploaded.publicId };
    } catch (err) {
      console.error("[product-media] Cloudinary video upload failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: GENERIC_IMAGE_FAILURE_MESSAGE };
    }
  }

  let decodedInput: Buffer = buffer;

  if (validation.sourceFormat === "heic") {
    try {
      const jpegOutput = await convertHeic({
        buffer,
        format: "JPEG",
        quality: HEIC_INTERMEDIATE_JPEG_QUALITY,
      });
      decodedInput = Buffer.from(jpegOutput);
    } catch (err) {
      console.error("[product-media] HEIC/HEIF decode failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: HEIC_FAILURE_MESSAGE };
    }
  }

  let webpBuffer: Buffer;
  try {
    webpBuffer = await sharp(decodedInput)
      // No-arg .rotate() auto-orients from the EXIF orientation tag, then
      // the tag itself is dropped from the output — iPhone photos are never
      // rotated incorrectly downstream.
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION_PX,
        height: MAX_IMAGE_DIMENSION_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (err) {
    console.error("[product-media] image conversion failed", {
      sourceFormat: validation.sourceFormat,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: GENERIC_IMAGE_FAILURE_MESSAGE };
  }

  try {
    const uploaded = await uploadBufferToCloudinary(webpBuffer, { resourceType: "image", format: "webp" });
    return { ok: true, url: uploaded.url, cloudinaryPublicId: uploaded.publicId };
  } catch (err) {
    console.error("[product-media] Cloudinary image upload failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: GENERIC_IMAGE_FAILURE_MESSAGE };
  }
}

export interface RemovableProductMedia {
  cloudinaryPublicId: string | null;
  mediaType: MediaType;
}

/**
 * Deletes previously uploaded Cloudinary assets. Entries with a null
 * cloudinaryPublicId (admin-pasted external URLs, or legacy rows saved
 * before this app used Cloudinary) are skipped — there is nothing to clean
 * up for those. Callers must first prove each entry is not referenced by
 * another ProductImage row. Never throws; returns the count of real
 * failures so the caller can surface a soft warning.
 */
export async function deleteUnreferencedUploadedProductFiles(
  entries: RemovableProductMedia[],
): Promise<number> {
  let failures = 0;

  for (const entry of entries) {
    if (!entry.cloudinaryPublicId) continue;

    try {
      await deleteFromCloudinary(entry.cloudinaryPublicId, entry.mediaType === "VIDEO" ? "video" : "image");
    } catch (error) {
      failures += 1;
      console.error("[product-removal] Cloudinary media cleanup failed", {
        operation: "cloudinary-destroy",
        publicId: entry.cloudinaryPublicId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return failures;
}
