import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AdminConfirmDialog, AdminErrorState, AdminPrimaryButton } from "@/components/admin/ui";
import type { Locale, Messages } from "@/shared/i18n";

const DISH_STATUSES = ["draft", "review", "published", "archived"] as const;

type DishStatus = (typeof DISH_STATUSES)[number];

const statusLabel = (status: string, copy: Messages): string => {
  if (status === "published") {
    return copy.adminPublished;
  }

  if (status === "review") {
    return copy.adminInReview;
  }

  if (status === "draft") {
    return copy.adminDraft;
  }

  if (status === "archived") {
    return copy.adminArchived;
  }

  return status;
};

export function DishStatusEditor({
  dishId,
  initialStatus,
  lang,
  copy,
  publicationCheck,
  saveStatus,
}: {
  readonly dishId: string;
  readonly initialStatus: string;
  readonly lang: Locale;
  readonly copy: Messages;
  readonly publicationCheck: (dishId: string) => Promise<{
    readonly publishable: boolean;
    readonly reasons: ReadonlyArray<string>;
  }>;
  readonly saveStatus: (dishId: string, status: DishStatus) => Promise<{ readonly status: string }>;
}): React.ReactNode {
  const router = useRouter();
  const [selected, setSelected] = useState(initialStatus);
  const [applied, setApplied] = useState(initialStatus);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const publication = useQuery({
    queryKey: ["admin", "publication-check", dishId],
    queryFn: () => publicationCheck(dishId),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (next: string) => {
      const status = DISH_STATUSES.find((entry) => entry === next) ?? "draft";

      return saveStatus(dishId, status);
    },
    onSuccess: (result) => {
      setApplied(result.status);
      setSaved(true);
      setSaveError(null);
      void router.invalidate();
    },
    onError: () => {
      setSaved(false);
      setSaveError(copy.adminStatusUpdateFailed);
    },
  });

  const check = publication.data ?? null;
  const unchanged = selected === applied;
  const publishBlocked = selected === "published" && check !== null && !check.publishable;
  const checkingPublish = selected === "published" && publication.isPending;
  const saveDisabled = save.isPending || unchanged || publishBlocked || checkingPublish;

  const publishDescription =
    lang === "vi"
      ? "Món này sẽ hiển thị công khai. Chỉ tiếp tục khi mọi thông tin đã được kiểm chứng."
      : "This dish will become publicly visible. Only continue when every detail is verified.";

  const persistStatus = (): void => {
    setSaved(false);
    setSaveError(null);
    save.mutate(selected);
  };

  const handleSave = (): void => {
    if (selected === "published" && applied !== "published") {
      setConfirmOpen(true);

      return;
    }

    persistStatus();
  };

  const handleConfirmPublish = (): void => {
    setConfirmOpen(false);
    persistStatus();
  };

  const handleCancelPublish = (): void => {
    setConfirmOpen(false);
  };

  const handleRetryChecklist = (): void => {
    void publication.refetch();
  };

  return (
    <section
      aria-labelledby="dish-status-heading"
      className="min-w-0 rounded-2xl border border-border-soft bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dish-status-heading" className="text-lg font-bold">
          {copy.adminStatus}
        </h2>
        <p className="rounded-full bg-cream px-3 py-1 text-sm font-bold text-food-orange-dark">
          {statusLabel(applied, copy)}
        </p>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="admin-dish-status-select" className="text-sm font-semibold">
          {copy.adminStatus}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="admin-dish-status-select"
            value={selected}
            onChange={(event) => {
              const next = DISH_STATUSES.find((entry) => entry === event.target.value);

              if (next !== undefined) {
                setSelected(next);
              }
            }}
            className="min-h-11 w-48 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm"
          >
            {DISH_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {statusLabel(entry, copy)}
              </option>
            ))}
          </select>
          <AdminPrimaryButton
            type="button"
            disabled={saveDisabled}
            aria-busy={save.isPending}
            onClick={handleSave}
          >
            {copy.authSave}
          </AdminPrimaryButton>
        </div>

        {selected === "published" ? (
          <div className="rounded-lg bg-cream px-3 py-2 text-sm" aria-live="polite">
            <p className="font-semibold">{copy.adminPublicationChecklist}</p>
            {publication.isPending ? <p>{copy.adminCheckingPublication}</p> : null}
            {publication.isError ? (
              <div className="mt-2">
                <AdminErrorState
                  message={copy.adminLoadFailed}
                  retryLabel={copy.adminRetryChecklist}
                  onRetry={handleRetryChecklist}
                  pending={publication.isPending}
                />
              </div>
            ) : null}
            {check !== null && check.publishable ? <p>{copy.adminPublicationReady}</p> : null}
            {check !== null && !check.publishable ? (
              <div>
                <p>{copy.adminPublishBlocked}</p>
                <ul className="mt-1 list-disc pl-5">
                  {check.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div aria-live="polite">
          {saved ? <p className="text-sm font-semibold">{copy.authSaved}</p> : null}
          {saveError !== null ? (
            <AdminErrorState
              message={saveError}
              retryLabel={copy.commonRetry}
              onRetry={persistStatus}
              pending={save.isPending}
            />
          ) : null}
        </div>
      </div>

      <AdminConfirmDialog
        open={confirmOpen}
        title={copy.adminPublishConfirm}
        description={publishDescription}
        confirmLabel={copy.commonConfirm}
        cancelLabel={copy.commonCancel}
        dangerous
        pending={save.isPending}
        onConfirm={handleConfirmPublish}
        onCancel={handleCancelPublish}
      />
    </section>
  );
}
