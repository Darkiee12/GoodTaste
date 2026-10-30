import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImagePlus, Pencil, Star, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { CollapsiblePanel } from "@/components/admin/dish/CollapsiblePanel";
import {
  DishPhotoEditor,
  type PhotoEditorInitial,
  type PhotoSaveInput,
  type PhotoSaveResult,
} from "@/components/admin/dish/photo-editor";
import { AdminConfirmDialog, AdminGhostButton, AdminPrimaryButton } from "@/components/admin/ui";
import {
  listDishPhotosFn,
  publishDishPhotoFn,
  removeDishPhotoFn,
  reorderDishPhotosFn,
  returnDishPhotoToDraftFn,
  stageDishPhotoFn,
  submitDishPhotoForReviewFn,
  updateDishPhotoMetadataFn,
} from "@/modules/food-discovery/admin.functions";
import type { DishPhotoAdminView } from "@/modules/food-discovery/server/operations/dish-media-service";
import type { Locale } from "@/shared/i18n";

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

type Notice = { readonly kind: "ok" | "error"; readonly text: string } | null;

const BLANK_EDITOR: PhotoEditorInitial = {
  mode: "create",
  altText: "",
  attribution: "",
  license: "unknown",
  focalX: null,
  focalY: null,
  sourceUrl: "",
  makePrimary: false,
  existingImageUrl: null,
};

/**
 * Dish photo library. Compact and collapsible like every other dish panel:
 * empty state with a single Add action, thumbnail grid with status, primary
 * star, short attribution, and icon actions, and a dialog editor for the
 * upload journey. Data refreshes from the server after every mutation.
 */
export function DishPhotosPanel({
  dishId,
  lang,
}: {
  readonly dishId: string;
  readonly lang: Locale;
}): React.ReactNode {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<PhotoEditorInitial | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DishPhotoAdminView | null>(null);
  const [pendingPublish, setPendingPublish] = useState<DishPhotoAdminView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const photosQuery = useQuery({
    queryKey: ["admin", "dish-photos", dishId],
    queryFn: () => listDishPhotosFn({ data: { dishId } }),
    staleTime: 15_000,
  });

  const photos = photosQuery.data ?? [];

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "dish-photos", dishId] });
  };

  const failNotice = (reason: string): void => {
    setNotice({ kind: "error", text: reason });
  };

  const runMutation = async (
    label: string,
    task: () => Promise<{ readonly ok: boolean; readonly reason?: string }>,
  ): Promise<void> => {
    setBusy(true);
    setNotice(null);

    try {
      const outcome = await task();

      if (outcome.ok) {
        await refresh();
        setNotice({ kind: "ok", text: label });
      } else {
        failNotice(outcome.reason ?? label);
      }
    } catch (error) {
      failNotice(error instanceof Error ? error.message : label);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (input: PhotoSaveInput): Promise<PhotoSaveResult> => {
    if (editingId !== null) {
      const outcome = await updateDishPhotoMetadataFn({
        data: {
          mediaId: editingId,
          altText: input.altText,
          attribution: input.attribution,
          license: input.license,
          focalX: input.focalX,
          focalY: input.focalY,
          sourceUrl: input.sourceUrl,
        },
      });

      if (outcome.ok) {
        setEditingId(null);
        setEditor(null);
        await refresh();
        setNotice({ kind: "ok", text: pick(lang, "Photo details saved.", "Đã lưu chi tiết ảnh.") });

        return outcome;
      }

      return outcome;
    }

    if (input.dataBase64 === null) {
      return { ok: false, reason: pick(lang, "Choose a photo first.", "Hãy chọn ảnh trước.") };
    }

    const outcome = await stageDishPhotoFn({
      data: {
        dishId,
        filename: input.filename,
        contentType:
          input.contentType === "image/png" || input.contentType === "image/webp"
            ? input.contentType
            : "image/jpeg",
        dataBase64: input.dataBase64,
        makePrimary: photos.length === 0 ? true : input.makePrimary,
        altText: input.altText,
        attribution: input.attribution,
        license: input.license,
        focalX: input.focalX,
        focalY: input.focalY,
        sourceUrl: input.sourceUrl,
      },
    });

    if (outcome.ok) {
      setEditor(null);
      await refresh();
      setNotice({
        kind: "ok",
        text: pick(lang, "Photo saved for review.", "Đã lưu ảnh chờ duyệt."),
      });
    }

    return outcome;
  };

  const movePhoto = (id: string, direction: -1 | 1): void => {
    const index = photos.findIndex((photo) => photo.id === id);
    const target = index + direction;

    if (index < 0 || target < 0 || target >= photos.length) {
      return;
    }

    const ordered = photos.map((photo) => photo.id);
    const [moved] = ordered.splice(index, 1);

    if (moved === undefined) {
      return;
    }

    ordered.splice(target, 0, moved);

    void runMutation(pick(lang, "Photo order saved.", "Đã lưu thứ tự ảnh."), async () =>
      reorderDishPhotosFn({
        data: { dishId, orderedIds: ordered },
      }),
    );
  };

  const makePrimary = (id: string): void => {
    const rest = photos.map((photo) => photo.id).filter((entry) => entry !== id);

    void runMutation(pick(lang, "Primary photo updated.", "Đã cập nhật ảnh chính."), async () =>
      reorderDishPhotosFn({
        data: { dishId, orderedIds: [id, ...rest] },
      }),
    );
  };

  const statusPill = (status: string): string => {
    if (status === "published") {
      return pick(lang, "Published", "Đã xuất bản");
    }

    if (status === "review") {
      return pick(lang, "In review", "Chờ duyệt");
    }

    return pick(lang, "Draft", "Nháp");
  };

  let panelBody: ReactNode;

  if (photosQuery.isPending) {
    panelBody = (
      <output
        aria-label={pick(lang, "Loading photos", "Đang tải ảnh")}
        className="block text-sm text-muted"
      >
        {pick(lang, "Loading photos…", "Đang tải ảnh…")}
      </output>
    );
  } else if (photosQuery.isError) {
    panelBody = (
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p role="alert" className="text-sm text-red-700">
          {pick(lang, "Could not load photos.", "Không tải được ảnh.")}
        </p>
        <AdminGhostButton type="button" onClick={() => void photosQuery.refetch()}>
          {pick(lang, "Retry", "Thử lại")}
        </AdminGhostButton>
      </div>
    );
  } else if (photos.length === 0) {
    panelBody = (
      <div className="flex min-w-0 flex-col items-start gap-2">
        <p className="text-sm text-muted">
          {pick(
            lang,
            "No photos yet. Add the first one to represent this dish.",
            "Chưa có ảnh. Hãy thêm ảnh đầu tiên cho món ăn này.",
          )}
        </p>
        <AdminPrimaryButton
          type="button"
          onClick={() => {
            setEditingId(null);
            setEditor({ ...BLANK_EDITOR, makePrimary: true });
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <ImagePlus aria-hidden="true" className="size-4" />
            {pick(lang, "Add photos", "Thêm ảnh")}
          </span>
        </AdminPrimaryButton>
      </div>
    );
  } else {
    panelBody = (
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {pick(
              lang,
              "First photo is primary. Published photos appear publicly.",
              "Ảnh đầu tiên là ảnh chính. Ảnh đã xuất bản hiển thị công khai.",
            )}
          </p>
          <AdminPrimaryButton
            type="button"
            disabled={photos.length >= 5 || busy}
            onClick={() => {
              setEditingId(null);
              setEditor(BLANK_EDITOR);
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <ImagePlus aria-hidden="true" className="size-4" />
              {pick(lang, "Add photos", "Thêm ảnh")}
            </span>
          </AdminPrimaryButton>
        </div>

        <PhotoGrid
          photos={photos}
          lang={lang}
          busy={busy}
          onEdit={(photo) => {
            setEditingId(photo.id);
            setEditor({
              mode: "edit",
              altText: photo.altText ?? "",
              attribution: photo.attribution ?? "",
              license: photo.license,
              focalX: photo.focalX,
              focalY: photo.focalY,
              sourceUrl: photo.sourceUrl ?? "",
              makePrimary: false,
              existingImageUrl: photo.previewUrl ?? photo.deliveryUrl ?? photo.externalUrl,
            });
          }}
          onDelete={(photo) => setPendingDelete(photo)}
          onPublish={(photo) => setPendingPublish(photo)}
          onPrimary={makePrimary}
          onMove={movePhoto}
          onSubmitForReview={(photo) =>
            void runMutation(
              pick(lang, "Photo submitted for review.", "Đã gửi ảnh chờ duyệt."),
              async () => submitDishPhotoForReviewFn({ data: { mediaId: photo.id } }),
            )
          }
          onReturnToDraft={(photo, label) =>
            void runMutation(label, async () =>
              returnDishPhotoToDraftFn({ data: { mediaId: photo.id } }),
            )
          }
          statusPill={statusPill}
        />
      </div>
    );
  }

  let noticeElement: ReactNode = null;

  if (notice !== null) {
    noticeElement =
      notice.kind === "error" ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {notice.text}
        </p>
      ) : (
        <output className="mt-2 block text-sm text-green-700">{notice.text}</output>
      );
  }

  return (
    <>
      <CollapsiblePanel
        title={pick(lang, "Photos", "Ảnh")}
        defaultOpen={photos.length > 0}
        badge={
          <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
            {photos.length}/5
          </span>
        }
      >
        {panelBody}

        {noticeElement}
      </CollapsiblePanel>

      {editor !== null ? (
        <DishPhotoEditor
          key={editingId ?? "new-photo"}
          open
          lang={lang}
          initial={editor}
          onSave={handleSave}
          onClose={() => {
            setEditor(null);
            setEditingId(null);
          }}
        />
      ) : null}

      <AdminConfirmDialog
        open={pendingDelete !== null}
        title={pick(lang, "Delete this photo?", "Xóa ảnh này?")}
        description={pick(
          lang,
          "The database row and all stored derivatives are removed. Public pages stop showing it immediately.",
          "Dòng dữ liệu và mọi bản sao đã lưu sẽ bị xóa. Trang công khai ngừng hiển thị ngay lập tức.",
        )}
        confirmLabel={pick(lang, "Delete photo", "Xóa ảnh")}
        cancelLabel={pick(lang, "Keep photo", "Giữ ảnh")}
        dangerous
        pending={busy}
        onConfirm={() => {
          const target = pendingDelete;

          setPendingDelete(null);

          if (target === null) {
            return;
          }

          void runMutation(pick(lang, "Photo deleted.", "Đã xóa ảnh."), async () =>
            removeDishPhotoFn({
              data: { mediaId: target.id },
            }),
          );
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <AdminConfirmDialog
        open={pendingPublish !== null}
        title={pick(lang, "Publish this photo?", "Xuất bản ảnh này?")}
        description={pick(
          lang,
          "Publishing requires a stored image with variants, a real license, attribution, and alt text. The photo becomes publicly visible.",
          "Xuất bản yêu cầu ảnh đã lưu kèm các bản sao, giấy phép thật, ghi công và văn bản thay thế. Ảnh sẽ hiển thị công khai.",
        )}
        confirmLabel={pick(lang, "Publish photo", "Xuất bản ảnh")}
        cancelLabel={pick(lang, "Not yet", "Để sau")}
        pending={busy}
        onConfirm={() => {
          const target = pendingPublish;

          setPendingPublish(null);

          if (target === null) {
            return;
          }

          void runMutation(pick(lang, "Photo published.", "Đã xuất bản ảnh."), async () =>
            publishDishPhotoFn({
              data: { mediaId: target.id },
            }),
          );
        }}
        onCancel={() => setPendingPublish(null)}
      />
    </>
  );
}

function PhotoGrid({
  photos,
  lang,
  busy,
  onEdit,
  onDelete,
  onPublish,
  onPrimary,
  onMove,
  onSubmitForReview,
  onReturnToDraft,
  statusPill,
}: {
  readonly photos: ReadonlyArray<DishPhotoAdminView>;
  readonly lang: Locale;
  readonly busy: boolean;
  readonly onEdit: (photo: DishPhotoAdminView) => void;
  readonly onDelete: (photo: DishPhotoAdminView) => void;
  readonly onPublish: (photo: DishPhotoAdminView) => void;
  readonly onPrimary: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onSubmitForReview: (photo: DishPhotoAdminView) => void;
  readonly onReturnToDraft: (photo: DishPhotoAdminView, label: string) => void;
  readonly statusPill: (status: string) => string;
}): ReactNode {
  return (
    <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo, index) => {
        const thumb = photo.previewUrl ?? photo.deliveryUrl ?? photo.externalUrl;

        return (
          <li key={photo.id} className="min-w-0 rounded-xl border border-border-soft bg-white p-2">
            <div
              className="relative min-w-0 overflow-hidden rounded-lg bg-cream"
              style={{ aspectRatio: "4 / 3" }}
            >
              {thumb !== null ? (
                <img
                  src={thumb}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  style={
                    photo.focalX !== null && photo.focalY !== null
                      ? { objectPosition: `${photo.focalX * 100}% ${photo.focalY * 100}%` }
                      : undefined
                  }
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">
                  {pick(lang, "No preview", "Không có xem trước")}
                </span>
              )}
              <span className="absolute top-1 left-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">
                {statusPill(photo.status)}
              </span>
              {photo.isPrimary ? (
                <span
                  aria-label={pick(lang, "Primary photo", "Ảnh chính")}
                  title={pick(lang, "Primary photo", "Ảnh chính")}
                  className="absolute top-1 right-1 rounded-full bg-food-orange px-1.5 py-0.5"
                >
                  <Star aria-hidden="true" className="size-3 fill-white text-white" />
                </span>
              ) : null}
            </div>

            <p title={photo.attribution ?? ""} className="mt-1 min-w-0 truncate text-xs text-muted">
              {photo.attribution ?? photo.license}
            </p>

            <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  title={pick(lang, "Edit details", "Sửa chi tiết")}
                  aria-label={pick(
                    lang,
                    `Edit photo ${index + 1} details`,
                    `Sửa chi tiết ảnh ${index + 1}`,
                  )}
                  disabled={busy}
                  onClick={() => onEdit(photo)}
                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border-soft text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={pick(lang, "Delete photo", "Xóa ảnh")}
                  aria-label={pick(lang, `Delete photo ${index + 1}`, `Xóa ảnh ${index + 1}`)}
                  disabled={busy}
                  onClick={() => onDelete(photo)}
                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border-soft text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={pick(lang, "Set as primary", "Đặt làm ảnh chính")}
                  aria-label={pick(
                    lang,
                    `Set photo ${index + 1} as primary`,
                    `Đặt ảnh ${index + 1} làm ảnh chính`,
                  )}
                  aria-pressed={photo.isPrimary}
                  disabled={busy || photo.isPrimary}
                  onClick={() => onPrimary(photo.id)}
                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border-soft text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Star
                    aria-hidden="true"
                    className={`size-3.5 ${photo.isPrimary ? "fill-food-orange text-food-orange" : ""}`}
                  />
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title={pick(lang, "Move earlier", "Chuyển lên trước")}
                  aria-label={pick(
                    lang,
                    `Move photo ${index + 1} earlier`,
                    `Chuyển ảnh ${index + 1} lên trước`,
                  )}
                  disabled={busy || index === 0}
                  onClick={() => onMove(photo.id, -1)}
                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border-soft text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={pick(lang, "Move later", "Chuyển xuống sau")}
                  aria-label={pick(
                    lang,
                    `Move photo ${index + 1} later`,
                    `Chuyển ảnh ${index + 1} xuống sau`,
                  )}
                  disabled={busy || index === photos.length - 1}
                  onClick={() => onMove(photo.id, 1)}
                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border border-border-soft text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-1 flex min-w-0 flex-wrap gap-1">
              {photo.status === "draft" ? (
                <button
                  type="button"
                  disabled={busy || photo.processing !== "ready"}
                  onClick={() => onSubmitForReview(photo)}
                  className="cursor-pointer rounded-full bg-cream px-2 py-1 text-xs font-bold text-food-orange-dark hover:bg-border-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pick(lang, "Submit for review", "Gửi duyệt")}
                </button>
              ) : null}
              {photo.status === "review" ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPublish(photo)}
                    className="cursor-pointer rounded-full bg-cream px-2 py-1 text-xs font-bold text-food-orange-dark hover:bg-border-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pick(lang, "Publish", "Xuất bản")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onReturnToDraft(
                        photo,
                        pick(lang, "Photo returned to draft.", "Đã chuyển ảnh về nháp."),
                      )
                    }
                    className="cursor-pointer rounded-full bg-cream px-2 py-1 text-xs font-bold text-muted hover:bg-border-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pick(lang, "To draft", "Về nháp")}
                  </button>
                </>
              ) : null}
              {photo.status === "published" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onReturnToDraft(
                      photo,
                      pick(lang, "Photo withdrawn to draft.", "Đã gỡ ảnh về nháp."),
                    )
                  }
                  className="cursor-pointer rounded-full bg-cream px-2 py-1 text-xs font-bold text-muted hover:bg-border-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pick(lang, "Withdraw", "Gỡ xuống")}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
