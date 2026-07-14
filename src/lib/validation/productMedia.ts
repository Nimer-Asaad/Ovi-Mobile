/**
 * Server-side validation for product media uploads. Never trust the
 * client-submitted MIME type alone for the extension — the extension used
 * for the saved file is always derived from this allowlist, never from the
 * uploaded File's original name.
 */

export const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type MediaType = "IMAGE" | "VIDEO";

export interface MediaValidationResult {
  ok: boolean;
  mediaType?: MediaType;
  extension?: string;
  error?: string;
}

/** Validates a File's MIME type and size against the allowlists above.
 * Returns the inferred mediaType and safe extension on success. */
export function validateMediaFile(file: File): MediaValidationResult {
  if (file.type in IMAGE_MIME_EXTENSIONS) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: "حجم الصورة يجب ألا يتجاوز 5 ميجابايت" };
    }
    return { ok: true, mediaType: "IMAGE", extension: IMAGE_MIME_EXTENSIONS[file.type] };
  }

  if (file.type in VIDEO_MIME_EXTENSIONS) {
    if (file.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: "حجم الفيديو يجب ألا يتجاوز 50 ميجابايت" };
    }
    return { ok: true, mediaType: "VIDEO", extension: VIDEO_MIME_EXTENSIONS[file.type] };
  }

  return { ok: false, error: "نوع الملف غير مدعوم" };
}

/** Loose mediaType inference for pasted URLs (no file bytes to sniff) —
 * used only to decide IMAGE vs VIDEO rendering, never trusted for storage. */
export function inferMediaTypeFromUrl(url: string): MediaType {
  return /\.(mp4|webm)(\?|$)/i.test(url) ? "VIDEO" : "IMAGE";
}
