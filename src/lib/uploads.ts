import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import convertHeic from "heic-convert";
import { HEIC_FAILURE_MESSAGE, type MediaValidationSuccess } from "@/lib/validation/productMedia";

/** Local-disk storage for product media, under public/uploads/products/ so
 * Next.js serves it as a static asset at /uploads/products/<filename>. This
 * is a local/dev (or simple single-server hosting) strategy only — once the
 * app moves to a managed database/hosting setup, uploaded media should be
 * migrated to object storage (Supabase Storage, S3, Cloudinary, etc.)
 * instead of the server's local filesystem. */
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "products");
const PUBLIC_PATH_PREFIX = "/uploads/products";

/** Long-edge cap for any saved still image — never upscaled (sharp's
 * `withoutEnlargement`), aspect ratio always preserved. */
const MAX_IMAGE_DIMENSION_PX = 2400;
const WEBP_QUALITY = 85;
const HEIC_INTERMEDIATE_JPEG_QUALITY = 0.92;

const GENERIC_IMAGE_FAILURE_MESSAGE = "تعذر معالجة الصورة، يرجى المحاولة بملف آخر.";

export type SaveMediaResult = { ok: true; url: string } | { ok: false; error: string };

async function writeMediaBuffer(buffer: Buffer, extension: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  // Filename is always a fresh, server-generated UUID — never derived from
  // the client's original filename (path traversal / collision safety).
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  // Deliberately a hardcoded forward-slash template, not a URL built from
  // the OS-specific disk path above (path.join uses "\\" on Windows) — the
  // stored/public URL must never contain a backslash regardless of the host
  // OS this happens to run on.
  return `${PUBLIC_PATH_PREFIX}/${filename}`;
}

/**
 * Persists an already-validated media buffer (see validateMediaBuffer() in
 * src/lib/validation/productMedia.ts) under a fresh UUID filename.
 *
 * Video passes through unchanged (existing pipeline, preserved as-is).
 *
 * Every still-image format this app accepts (JPEG, PNG, WebP, HEIC/HEIF) is
 * standardized through one path: decode, auto-rotate from EXIF, cap the
 * long edge at MAX_IMAGE_DIMENSION_PX (never upscaled, aspect ratio kept),
 * re-encode as WebP, and metadata (EXIF/GPS/ICC beyond what's needed for
 * color) is dropped by not calling sharp's `.withMetadata()`. The saved
 * extension is therefore always ".webp" — decided from the real converted
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
    return { ok: true, url: await writeMediaBuffer(buffer, extension) };
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

  try {
    const webpBuffer = await sharp(decodedInput)
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

    return { ok: true, url: await writeMediaBuffer(webpBuffer, "webp") };
  } catch (err) {
    console.error("[product-media] image conversion failed", {
      sourceFormat: validation.sourceFormat,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: GENERIC_IMAGE_FAILURE_MESSAGE };
  }
}
