import { ImagePlus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AdminDialog, AdminGhostButton, AdminPrimaryButton } from "@/components/admin/ui";
import type { Locale } from "@/shared/i18n";

// Mirror of SUPPORTED_PHOTO_LICENSES in dish-media-service.ts. The service
// module is Node-only (Sharp/S3), so the browser duplicates the list instead
// of value-importing it.
const ACCEPTED_LICENSES: ReadonlySet<string> = new Set([
  "own-work",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "licensed",
]);

const ACCEPTED_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface PhotoSaveInput {
  readonly filename: string;
  readonly contentType: string;
  readonly dataBase64: string | null;
  readonly altText: string | null;
  readonly attribution: string | null;
  readonly license: string;
  readonly focalX: number | null;
  readonly focalY: number | null;
  readonly sourceUrl: string | null;
  readonly makePrimary: boolean;
}

export type PhotoSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface PhotoEditorInitial {
  readonly mode: "create" | "edit";
  readonly altText: string;
  readonly attribution: string;
  readonly license: string;
  readonly focalX: number | null;
  readonly focalY: number | null;
  readonly sourceUrl: string;
  readonly makePrimary: boolean;
  readonly existingImageUrl: string | null;
}

type SavePhase = "idle" | "preparing" | "uploading" | "finalizing";

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const result = reader.result;

      if (result instanceof ArrayBuffer || result === null) {
        reject(new Error("could not read file"));

        return;
      }

      resolve(result);
    });

    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("could not read file"));
    });

    reader.readAsDataURL(file);
  });

const loadDimensions = (objectUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const probe = new Image();

    probe.addEventListener("load", () => {
      resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    });

    probe.addEventListener("error", () => {
      reject(new Error("unreadable"));
    });

    probe.src = objectUrl;
  });

const formatBytes = (bytes: number): string => {
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MiB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
};

/**
 * Upload/editor drawer for one dish photo. Fixed header, scrollable body,
 * stable footer — never a giant inline expansion. The browser stages the
 * file (local ObjectURL preview, replace/remove/cancel) and nothing uploads
 * until Save; metadata survives failures and retry keeps every field.
 */
export function DishPhotoEditor({
  open,
  lang,
  initial,
  onSave,
  onClose,
}: {
  readonly open: boolean;
  readonly lang: Locale;
  readonly initial: PhotoEditorInitial;
  readonly onSave: (input: PhotoSaveInput) => Promise<PhotoSaveResult>;
  readonly onClose: () => void;
}): React.ReactNode {
  const fileInputId = useId();
  const altId = useId();
  const attributionId = useId();
  const licenseId = useId();
  const sourceId = useId();
  const primaryId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [altText, setAltText] = useState(initial.altText);
  const [attribution, setAttribution] = useState(initial.attribution);
  const [license, setLicense] = useState(initial.license);
  const [focalX, setFocalX] = useState<number | null>(initial.focalX);
  const [focalY, setFocalY] = useState<number | null>(initial.focalY);
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl);
  const [makePrimary, setMakePrimary] = useState(initial.makePrimary);
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardAsk, setDiscardAsk] = useState(false);

  useEffect(
    () => () => {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [objectUrl],
  );

  const dirty =
    file !== null ||
    altText !== initial.altText ||
    attribution !== initial.attribution ||
    license !== initial.license ||
    focalX !== initial.focalX ||
    focalY !== initial.focalY ||
    sourceUrl !== initial.sourceUrl ||
    makePrimary !== initial.makePrimary;

  const requestClose = (): void => {
    if (phase !== "idle") {
      return;
    }

    if (dirty && !discardAsk) {
      setDiscardAsk(true);

      return;
    }

    onClose();
  };

  const acceptFile = (candidate: File | null): void => {
    setFileError(null);
    setDimensions(null);

    if (candidate === null) {
      return;
    }

    if (!ACCEPTED_TYPES.has(candidate.type)) {
      setFileError(
        pick(
          lang,
          "Only JPEG, PNG, or WebP photos are accepted.",
          "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.",
        ),
      );

      return;
    }

    if (candidate.size > MAX_UPLOAD_BYTES) {
      setFileError(
        pick(lang, "That file exceeds the 8 MiB limit.", "Tệp vượt quá giới hạn 8 MiB."),
      );

      return;
    }

    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
    }

    const nextUrl = URL.createObjectURL(candidate);

    setFile(candidate);
    setObjectUrl(nextUrl);
    setDiscardAsk(false);

    loadDimensions(nextUrl).then(
      (dims) => {
        setDimensions(dims);

        if (Math.min(dims.width, dims.height) < 600) {
          setFileError(
            pick(
              lang,
              `That image is ${dims.width}×${dims.height}px; the shortest side must be at least 600px.`,
              `Ảnh ${dims.width}×${dims.height}px; cạnh ngắn nhất phải đạt ít nhất 600px.`,
            ),
          );
        }
      },
      () => {
        setFileError(
          pick(lang, "That file could not be read as an image.", "Không đọc được tệp ảnh này."),
        );
      },
    );
  };

  const previewUrl = objectUrl ?? (initial.mode === "edit" ? initial.existingImageUrl : null);
  const altValid = altText.trim().length > 0;
  const licenseValid = license === "unknown" || ACCEPTED_LICENSES.has(license);

  const canSave =
    phase === "idle" &&
    altValid &&
    licenseValid &&
    fileError === null &&
    (initial.mode === "edit" || file !== null);

  const handleSave = (): void => {
    if (!canSave) {
      return;
    }

    setPhase("preparing");
    setSaveError(null);

    const run = async (): Promise<void> => {
      let dataBase64: string | null = null;
      let filename = "";
      let contentType = "";

      if (file !== null) {
        const dataUrl = await readAsDataUrl(file);
        const comma = dataUrl.indexOf(",");

        dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : null;
        filename = file.name;
        contentType = file.type;
      }

      setPhase("uploading");

      const result = await onSave({
        filename,
        contentType,
        dataBase64,
        altText: altText.trim().length > 0 ? altText.trim() : null,
        attribution: attribution.trim().length > 0 ? attribution.trim() : null,
        license,
        focalX,
        focalY,
        sourceUrl: sourceUrl.trim().length > 0 ? sourceUrl.trim() : null,
        makePrimary,
      });

      if (result.ok) {
        setPhase("finalizing");
        onClose();

        return;
      }

      setSaveError(result.reason);
      setPhase("idle");
    };

    run().catch(() => {
      setSaveError(pick(lang, "Save failed; retry.", "Lưu thất bại; thử lại."));
      setPhase("idle");
    });
  };

  let phaseLabel: string | null = null;

  if (phase === "preparing") {
    phaseLabel = pick(lang, "Preparing…", "Đang chuẩn bị…");
  } else if (phase === "uploading") {
    phaseLabel = pick(lang, "Uploading…", "Đang tải lên…");
  } else if (phase === "finalizing") {
    phaseLabel = pick(lang, "Finalizing…", "Đang hoàn tất…");
  }

  let saveLabel = pick(lang, "Save photo", "Lưu ảnh");

  if (phase !== "idle") {
    saveLabel = phaseLabel ?? pick(lang, "Saving…", "Đang lưu…");
  }

  const pickFocal = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    setFocalX(Math.round(x * 1000) / 1000);
    setFocalY(Math.round(y * 1000) / 1000);
    setDiscardAsk(false);
  };

  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          requestClose();
        }
      }}
      title={
        initial.mode === "create"
          ? pick(lang, "Add photo", "Thêm ảnh")
          : pick(lang, "Edit photo", "Sửa ảnh")
      }
      description={pick(
        lang,
        "JPEG, PNG, or WebP · 8 MiB max · shortest side ≥ 600px. Nothing uploads until you save.",
        "JPEG, PNG hoặc WebP · tối đa 8 MiB · cạnh ngắn nhất ≥ 600px. Chưa tải lên cho đến khi bạn lưu.",
      )}
      closeLabel={pick(lang, "Close photo editor", "Đóng trình sửa ảnh")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="min-w-0 flex-1 text-sm text-muted">
            {saveError ??
              phaseLabel ??
              (discardAsk
                ? pick(lang, "Discard unsaved changes?", "Hủy các thay đổi chưa lưu?")
                : "")}
          </p>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {discardAsk ? (
              <>
                <AdminGhostButton type="button" onClick={() => setDiscardAsk(false)}>
                  {pick(lang, "Keep editing", "Tiếp tục sửa")}
                </AdminGhostButton>
                <AdminGhostButton type="button" onClick={onClose}>
                  {pick(lang, "Discard", "Hủy bỏ")}
                </AdminGhostButton>
              </>
            ) : (
              <>
                <AdminGhostButton type="button" onClick={requestClose} disabled={phase !== "idle"}>
                  {pick(lang, "Cancel", "Hủy")}
                </AdminGhostButton>
                <AdminPrimaryButton
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  aria-busy={phase !== "idle"}
                >
                  {saveLabel}
                </AdminPrimaryButton>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        {initial.mode === "create" ? (
          <button
            type="button"
            aria-label={pick(lang, "Choose a photo to upload", "Chọn ảnh để tải lên")}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              acceptFile(event.dataTransfer.files.item(0));
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`block min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center ${
              dragOver ? "border-food-orange bg-cream" : "border-border-soft bg-cream/40"
            }`}
          >
            <ImagePlus aria-hidden="true" className="size-6 text-food-orange-dark" />
            <p className="text-sm font-semibold">
              {pick(
                lang,
                "Drag a photo here, or tap to choose",
                "Kéo ảnh vào đây hoặc chạm để chọn",
              )}
            </p>
            <p className="text-xs text-muted">
              JPG · PNG · WebP — {formatBytes(MAX_UPLOAD_BYTES)} max
            </p>
          </button>
        ) : null}
        <label htmlFor={fileInputId} className="sr-only">
          {pick(lang, "Choose a photo to upload", "Chọn ảnh để tải lên")}
        </label>
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label={pick(lang, "Choose a photo to upload", "Chọn ảnh để tải lên")}
          onChange={(event) => {
            acceptFile(event.target.files?.item(0) ?? null);
            event.target.value = "";
          }}
        />

        {fileError !== null ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {fileError}
          </p>
        ) : null}

        {previewUrl !== null ? (
          <div className="min-w-0">
            <button
              type="button"
              aria-label={pick(lang, "Pick the focal point", "Chọn điểm lấy nét")}
              title={pick(lang, "Click to set the focal point", "Nhấn để đặt điểm lấy nét")}
              onClick={pickFocal}
              className="relative block min-w-0 w-full cursor-crosshair overflow-hidden rounded-xl border border-border-soft bg-cream p-0"
              style={{ aspectRatio: "4 / 3" }}
            >
              <img
                src={previewUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={
                  focalX !== null && focalY !== null
                    ? { objectPosition: `${focalX * 100}% ${focalY * 100}%` }
                    : undefined
                }
              />
              {focalX !== null && focalY !== null ? (
                <span
                  aria-hidden="true"
                  className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-food-orange shadow"
                  style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
                />
              ) : null}
            </button>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-xs text-muted">
                {file !== null
                  ? `${file.name} · ${formatBytes(file.size)}${dimensions !== null ? ` · ${dimensions.width}×${dimensions.height}px · ${file.type.replace("image/", "").toUpperCase()}` : ""}`
                  : pick(
                      lang,
                      "Current photo — click to set the focal point.",
                      "Ảnh hiện tại — nhấn để đặt điểm lấy nét.",
                    )}
              </p>
              <div className="flex shrink-0 gap-2">
                {focalX !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFocalX(null);
                      setFocalY(null);
                    }}
                    className="cursor-pointer text-xs font-semibold text-food-orange-dark underline"
                  >
                    {pick(lang, "Clear focal point", "Xóa điểm lấy nét")}
                  </button>
                ) : null}
                {initial.mode === "create" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="cursor-pointer text-xs font-semibold text-food-orange-dark underline"
                    >
                      {pick(lang, "Replace", "Thay ảnh")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (objectUrl !== null) {
                          URL.revokeObjectURL(objectUrl);
                        }

                        setFile(null);
                        setObjectUrl(null);
                        setDimensions(null);
                        setFileError(null);
                      }}
                      className="cursor-pointer text-xs font-semibold text-food-orange-dark underline"
                    >
                      {pick(lang, "Remove", "Gỡ ảnh")}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-3">
          <div className="min-w-0">
            <label htmlFor={altId} className="mb-1 block text-sm font-semibold">
              {pick(lang, "Alt text (required)", "Văn bản thay thế (bắt buộc)")}
            </label>
            <input
              id={altId}
              type="text"
              value={altText}
              maxLength={500}
              required
              aria-invalid={!altValid}
              onChange={(event) => {
                setAltText(event.target.value);
                setDiscardAsk(false);
              }}
              placeholder={pick(
                lang,
                "Describe the dish for screen readers",
                "Mô tả món ăn cho trình đọc màn hình",
              )}
              className="w-full min-w-0 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm"
            />
            {!altValid ? (
              <p className="mt-1 text-xs text-red-700">
                {pick(
                  lang,
                  "Alt text is required before saving.",
                  "Cần văn bản thay thế trước khi lưu.",
                )}
              </p>
            ) : null}
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={attributionId} className="mb-1 block text-sm font-semibold">
                {pick(lang, "Attribution", "Ghi công")}
              </label>
              <input
                id={attributionId}
                type="text"
                value={attribution}
                maxLength={500}
                onChange={(event) => {
                  setAttribution(event.target.value);
                  setDiscardAsk(false);
                }}
                placeholder={pick(lang, "Photographer or source", "Nhiếp ảnh gia hoặc nguồn")}
                className="w-full min-w-0 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={licenseId} className="mb-1 block text-sm font-semibold">
                {pick(lang, "License", "Giấy phép")}
              </label>
              <select
                id={licenseId}
                value={license}
                onChange={(event) => {
                  setLicense(event.target.value);
                  setDiscardAsk(false);
                }}
                className="w-full min-w-0 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm"
              >
                <option value="unknown">
                  {pick(lang, "Unknown (draft only)", "Chưa rõ (chỉ bản nháp)")}
                </option>
                {[...ACCEPTED_LICENSES].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-w-0">
            <label htmlFor={sourceId} className="mb-1 block text-sm font-semibold">
              {pick(lang, "Source URL (optional)", "URL nguồn (tùy chọn)")}
            </label>
            <input
              id={sourceId}
              type="url"
              inputMode="url"
              value={sourceUrl}
              maxLength={2000}
              onChange={(event) => {
                setSourceUrl(event.target.value);
                setDiscardAsk(false);
              }}
              placeholder="https://…"
              className="w-full min-w-0 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm"
            />
          </div>

          {initial.mode === "create" ? (
            <label
              htmlFor={primaryId}
              className="flex min-w-0 cursor-pointer items-center gap-2 text-sm"
            >
              <input
                id={primaryId}
                type="checkbox"
                checked={makePrimary}
                onChange={(event) => {
                  setMakePrimary(event.target.checked);
                  setDiscardAsk(false);
                }}
                className="size-4 accent-food-orange"
              />
              {pick(lang, "Set as primary photo", "Đặt làm ảnh chính")}
            </label>
          ) : null}
        </div>
      </div>
    </AdminDialog>
  );
}
