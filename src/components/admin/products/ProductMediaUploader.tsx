"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export interface ExistingProductMedia {
  url: string;
  mediaType: string;
  altText: string | null;
}

interface MediaSlot {
  key: string;
  kind: "existing" | "new";
  existingUrl?: string;
  existingMediaType?: string;
  file?: File;
  filePreviewUrl?: string;
  urlInput: string;
}

interface ProductMediaUploaderProps {
  existingMedia?: ExistingProductMedia[];
  error?: string;
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.webm";

function makeKey(): string {
  return Math.random().toString(36).slice(2);
}

function slotIsVideo(slot: MediaSlot): boolean {
  if (slot.kind === "existing") return slot.existingMediaType === "VIDEO";
  if (slot.file) return slot.file.type.startsWith("video/");
  return /\.(mp4|webm)(\?|$)/i.test(slot.urlInput);
}

/** The browser cannot decode/preview HEIC/HEIF for display (no native
 * `<img>` support in any current engine), so a blob preview would always
 * come back as a broken image — detected here by MIME type first, falling
 * back to the filename extension since iOS Safari often leaves `file.type`
 * empty for HEIC. The real, authoritative format check still happens
 * server-side on the actual file bytes (src/lib/validation/productMedia.ts)
 * — this is a display-only heuristic, never trusted for validation. */
function slotIsUnpreviewableHeic(slot: MediaSlot): boolean {
  if (slot.kind !== "new" || !slot.file) return false;
  const type = slot.file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  if (type === "") return /\.(heic|heif)$/i.test(slot.file.name);
  return false;
}

function slotPreviewUrl(slot: MediaSlot): string | null {
  if (slot.kind === "existing") return slot.existingUrl ?? null;
  if (slot.filePreviewUrl) return slot.filePreviewUrl;
  return slot.urlInput.trim() || null;
}

/** Dynamic add/remove media manager for the product form. Each slot is
 * either an existing saved media item, a newly uploaded file, or a pasted
 * URL — an uploaded file always wins over a pasted URL in the same slot.
 * Renders plain named inputs (no client-side FormData assembly) so this
 * plugs directly into the surrounding <form action={formAction}>; the
 * server action (src/app/admin/products/actions.ts) reads media_<i>_* by
 * index and re-validates everything, including which slot is main. */
export function ProductMediaUploader({ existingMedia = [], error }: ProductMediaUploaderProps) {
  const [slots, setSlots] = useState<MediaSlot[]>(() => {
    if (existingMedia.length > 0) {
      return existingMedia.map((media) => ({
        key: makeKey(),
        kind: "existing" as const,
        existingUrl: media.url,
        existingMediaType: media.mediaType,
        urlInput: "",
      }));
    }
    return [{ key: makeKey(), kind: "new" as const, urlInput: "" }];
  });

  const firstImageIndex = slots.findIndex((slot) => !slotIsVideo(slot));
  const [mainIndex, setMainIndex] = useState(firstImageIndex);
  // Keys of previews ("<slotKey>:<previewUrl>") whose <img>/<video> failed to
  // load — swapped to a placeholder instead of the browser's broken-media
  // icon. Keyed by preview identity, not just slot, so picking a new file in
  // the same slot clears the failed state automatically.
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());

  function markPreviewFailed(previewKey: string) {
    setFailedPreviews((prev) => new Set(prev).add(previewKey));
  }

  function addSlot() {
    setSlots((prev) => [...prev, { key: makeKey(), kind: "new", urlInput: "" }]);
  }

  function removeSlot(index: number) {
    setSlots((prev) => {
      const target = prev[index];
      if (target?.filePreviewUrl) URL.revokeObjectURL(target.filePreviewUrl);
      return prev.filter((_, i) => i !== index);
    });
    setMainIndex((prev) => {
      if (prev === index) return -1;
      if (prev > index) return prev - 1;
      return prev;
    });
  }

  function setSlotFile(index: number, file: File | null) {
    setSlots((prev) =>
      prev.map((slot, i) => {
        if (i !== index) return slot;
        if (slot.filePreviewUrl) URL.revokeObjectURL(slot.filePreviewUrl);
        return {
          ...slot,
          file: file ?? undefined,
          filePreviewUrl: file ? URL.createObjectURL(file) : undefined,
          urlInput: file ? "" : slot.urlInput,
        };
      }),
    );
  }

  function setSlotUrl(index: number, url: string) {
    setSlots((prev) =>
      prev.map((slot, i) => {
        if (i !== index) return slot;
        if (slot.filePreviewUrl) URL.revokeObjectURL(slot.filePreviewUrl);
        return { ...slot, file: undefined, filePreviewUrl: undefined, urlInput: url };
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="mediaCount" value={slots.length} />
      <input type="hidden" name="mainMediaIndex" value={mainIndex} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((slot, index) => {
          const preview = slotPreviewUrl(slot);
          const isVideo = slotIsVideo(slot);
          const isMain = mainIndex === index;
          const previewKey = `${slot.key}:${preview ?? ""}`;
          const previewFailed = failedPreviews.has(previewKey);
          const isHeicNoPreview = slotIsUnpreviewableHeic(slot);

          return (
            <div key={slot.key} className="flex flex-col gap-3 rounded-card border border-navy-soft p-3">
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-card bg-navy-deep">
                {isHeicNoPreview ? (
                  <div className="flex flex-col items-center gap-1 px-2 text-center">
                    <span className="rounded-card bg-gold-champagne/15 px-2 py-1 text-[10px] font-semibold text-gold-dark">
                      HEIC
                    </span>
                    <span className="line-clamp-2 text-xs text-neutral-bg/60">{slot.file?.name}</span>
                    <span className="text-[10px] text-neutral-bg/40">سيتم تحويلها تلقائياً بعد الحفظ</span>
                  </div>
                ) : preview && !previewFailed ? (
                  isVideo ? (
                    <video
                      src={preview}
                      className="h-full w-full object-cover"
                      muted
                      controls
                      onError={() => markPreviewFailed(previewKey)}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview or arbitrary admin URL
                    <img
                      src={preview}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() => markPreviewFailed(previewKey)}
                    />
                  )
                ) : previewFailed ? (
                  <span className="px-2 text-center text-xs text-neutral-bg/40">تعذر تحميل المعاينة</span>
                ) : (
                  <span className="text-xs text-neutral-bg/40">لا توجد معاينة</span>
                )}
              </div>

              {slot.kind === "existing" && <input type="hidden" name={`media_${index}_kind`} value="existing" />}
              {slot.kind === "existing" && (
                <>
                  <input type="hidden" name={`media_${index}_url`} value={slot.existingUrl} />
                  <input type="hidden" name={`media_${index}_mediaType`} value={slot.existingMediaType} />
                  <p className="truncate text-xs text-neutral-bg/50">{slot.existingUrl}</p>
                </>
              )}

              {slot.kind === "new" && (
                <>
                  <input type="hidden" name={`media_${index}_kind`} value="new" />
                  <input
                    type="file"
                    name={`media_${index}_file`}
                    accept={ACCEPT}
                    disabled={!!slot.urlInput}
                    onChange={(event) => setSlotFile(index, event.target.files?.[0] ?? null)}
                    className="text-xs text-neutral-bg/70 file:me-2 file:rounded-card file:border-0 file:bg-gold-champagne/15 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gold-dark"
                  />
                  <Input
                    type="url"
                    name={`media_${index}_url`}
                    placeholder="أو الصق رابط https://..."
                    value={slot.urlInput}
                    disabled={!!slot.file}
                    onChange={(event) => setSlotUrl(index, event.target.value)}
                  />
                </>
              )}

              <div className="flex items-center justify-between gap-2">
                <label
                  className={cn(
                    "flex items-center gap-1.5 text-xs",
                    isVideo ? "text-neutral-bg/30" : "text-neutral-bg/70",
                  )}
                >
                  <input
                    type="radio"
                    name="mainMediaChoice"
                    checked={isMain}
                    disabled={isVideo}
                    onChange={() => setMainIndex(index)}
                    className="h-3.5 w-3.5"
                  />
                  صورة رئيسية
                </label>
                <button
                  type="button"
                  onClick={() => removeSlot(index)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  إزالة
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addSlot}>
          إضافة وسائط
        </Button>
        <p className="text-xs text-neutral-bg/50">
          صور: JPEG وPNG وWebP وHEIC/HEIF (صور آيفون) حتى 5 ميجابايت — يتم تحويلها جميعاً تلقائياً إلى WebP بعد الحفظ.
          صيغة GIF لم تعد مدعومة. فيديو: MP4 وWebM حتى 50 ميجابايت. الصورة الرئيسية يجب أن تكون صورة وليست فيديو.
        </p>
      </div>
    </div>
  );
}
