/**
 * Server-side validation for product media uploads. The declared MIME type
 * (`File.type`) and original filename are never trusted alone — iOS Safari
 * in particular often sends HEIC files with an empty or generic `file.type`.
 * The authoritative signal is the file's actual binary signature (magic
 * bytes), sniffed here from the first bytes of the buffer. The extension
 * used for the saved file is always derived from the real, converted output
 * format (see src/lib/uploads.ts), never from the client's original
 * filename or declared MIME type.
 */

export type ImageSourceFormat = "jpeg" | "png" | "webp" | "heic";
export type VideoSourceFormat = "mp4" | "webm";
export type SourceFormat = ImageSourceFormat | VideoSourceFormat;
/** Detected but deliberately not accepted — see the GIF branch in
 * validateMediaBuffer(). Kept as its own sniff result (rather than folding
 * into "unknown") so rejection can give a specific, honest reason instead
 * of a generic "unsupported format" message. */
export type RejectedSniffFormat = "gif";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type MediaType = "IMAGE" | "VIDEO";

export interface MediaValidationSuccess {
  ok: true;
  mediaType: MediaType;
  /** Real, sniffed source format — drives which conversion path
   * saveUploadedProductFile() takes. Not a saved-file extension. */
  sourceFormat: SourceFormat;
  /** Only set for VIDEO — video is stored as-is, so its extension is fixed
   * at validation time (unlike images, which are always re-encoded). */
  videoExtension?: "mp4" | "webm";
}

export interface MediaValidationFailure {
  ok: false;
  error: string;
}

export type MediaValidationResult = MediaValidationSuccess | MediaValidationFailure;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "3gp4",
  "3gp5",
  "m4v ",
  "m4a ",
  "qt  ",
]);

/** Sniffs the real file format from its magic bytes — never trusts the
 * client-declared MIME type or filename extension. Deliberately has no SVG
 * branch: SVG is XML (script-capable) and is never accepted, regardless of
 * what a client claims — anything not matching a known binary signature
 * below falls through to "unknown" and is rejected by validateMediaBuffer. */
export function sniffMediaFormat(buffer: Buffer): SourceFormat | RejectedSniffFormat | "unknown" {
  if (buffer.length < 12) return "unknown";

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  // GIF: "GIF87a" or "GIF89a"
  const gifHeader = buffer.subarray(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "gif";

  // WEBP: "RIFF"....'WEBP'
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }

  // ISO-BMFF container (HEIC/HEIF/MP4 all share this shape): bytes 4-8 are
  // "ftyp", the 4-byte brand follows immediately at bytes 8-12.
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (MP4_BRANDS.has(brand)) return "mp4";
  }

  // WebM/Matroska: EBML header 1A 45 DF A3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "webm";

  return "unknown";
}

const HEIC_FAILURE_MESSAGE = "تعذر معالجة صورة HEIC. جرّب تصديرها كـ JPEG.";
const UNSUPPORTED_FORMAT_MESSAGE = "صيغة الصورة غير مدعومة.";
const GIF_NOT_SUPPORTED_MESSAGE = "صيغة GIF لم تعد مدعومة لصور المنتجات. الصيغ المدعومة: JPEG وPNG وWebP وHEIC/HEIF.";
const IMAGE_TOO_LARGE_MESSAGE = "حجم الصورة أكبر من الحد المسموح (5 ميجابايت).";
const VIDEO_TOO_LARGE_MESSAGE = "حجم الفيديو يجب ألا يتجاوز 50 ميجابايت";

/** Validates an already-read buffer against its real (sniffed) signature —
 * never the declared MIME type alone. Returns the sniffed sourceFormat,
 * which src/lib/uploads.ts uses to decide the conversion path; the final
 * saved extension is decided there, after conversion, not here.
 *
 * GIF is deliberately rejected here (accepted image formats are JPEG, PNG,
 * WebP, HEIC, HEIF only) — this only affects new uploads. Any GIF already
 * stored from before this change is untouched; nothing here reads or
 * mutates existing ProductImage rows. */
export function validateMediaBuffer(buffer: Buffer): MediaValidationResult {
  const sniffed = sniffMediaFormat(buffer);

  if (sniffed === "jpeg" || sniffed === "png" || sniffed === "webp" || sniffed === "heic") {
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: IMAGE_TOO_LARGE_MESSAGE };
    }
    return { ok: true, mediaType: "IMAGE", sourceFormat: sniffed };
  }

  if (sniffed === "gif") {
    return { ok: false, error: GIF_NOT_SUPPORTED_MESSAGE };
  }

  if (sniffed === "mp4" || sniffed === "webm") {
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      return { ok: false, error: VIDEO_TOO_LARGE_MESSAGE };
    }
    return { ok: true, mediaType: "VIDEO", sourceFormat: sniffed, videoExtension: sniffed };
  }

  return { ok: false, error: UNSUPPORTED_FORMAT_MESSAGE };
}

export { HEIC_FAILURE_MESSAGE };

/** Loose mediaType inference for pasted URLs (no file bytes to sniff) —
 * used only to decide IMAGE vs VIDEO rendering, never trusted for storage. */
export function inferMediaTypeFromUrl(url: string): MediaType {
  return /\.(mp4|webm)(\?|$)/i.test(url) ? "VIDEO" : "IMAGE";
}
