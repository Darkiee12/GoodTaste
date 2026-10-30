import { useState } from "react";

import type {
  BulkCandidatesPage,
  BulkPublishAcks,
  BulkPublishReport,
  BulkReviewCandidate,
  BulkReviewLabels,
} from "@/components/admin/reviews/bulk-review-types";
import {
  AdminCard,
  AdminConfirmDialog,
  AdminEmptyState,
  AdminErrorState,
  AdminGhostButton,
  AdminPrimaryButton,
  AdminTable,
} from "@/components/admin/ui";

/**
 * Bulk editorial review panel. Renders inside the reviews workspace (wired
 * by the coordinator into `admin.reviews.tsx`, which Agent C does not own):
 * filter candidates by import job, select rows, review metadata/provenance
 * flags, confirm large batches, and publish with honest per-record outcomes.
 *
 * All data flows through injected callbacks so the panel never imports
 * server functions directly; the coordinator binds these to the proposed
 * `adminBulkReviewCandidatesFn` / `adminBulkPublishFn`.
 */

const CONFIRM_THRESHOLD = 10;

const CANDIDATE_PAGE_SIZE = 50;

interface BulkReviewPanelProps {
  readonly labels: BulkReviewLabels;
  readonly initial: ReadonlyArray<BulkReviewCandidate>;
  readonly initialNextCursor: string | null;
  readonly loadCandidates: (input: {
    readonly cursor: string;
    readonly jobId: string | null;
    readonly limit: number;
  }) => Promise<BulkCandidatesPage>;
  readonly publishBatch: (input: {
    readonly ids: ReadonlyArray<string>;
    readonly acks: BulkPublishAcks;
  }) => Promise<BulkPublishReport>;
}

function flagsFor(candidate: BulkReviewCandidate, labels: BulkReviewLabels): ReadonlyArray<string> {
  const flags: Array<string> = [];

  if (!candidate.hasEnglishName) {
    flags.push(labels.flagNoEnglishName);
  }

  if (!candidate.hasDescription) {
    flags.push(labels.flagNoDescription);
  }

  if (candidate.ingredientCount === 0) {
    flags.push(labels.flagNoIngredients);
  }

  if (candidate.categoryCount === 0) {
    flags.push(labels.flagNoCategories);
  }

  if (candidate.placeCount === 0) {
    flags.push(labels.flagNoPlaces);
  }

  if (candidate.sourceCount === 0) {
    flags.push(labels.flagNoSources);
  }

  if (candidate.openQuestionCount > 0) {
    flags.push(labels.flagOpenQuestions(candidate.openQuestionCount));
  }

  if (candidate.licenseNeedsReview) {
    flags.push(labels.flagLicenseReview);
  }

  if (flags.length === 0) {
    flags.push(labels.flagReady);
  }

  return flags;
}

export function BulkReviewPanel({
  labels,
  initial,
  initialNextCursor,
  loadCandidates,
  publishBatch,
}: BulkReviewPanelProps) {
  const [rows, setRows] = useState<ReadonlyArray<BulkReviewCandidate>>(initial);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [jobFilter, setJobFilter] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [editorialAck, setEditorialAck] = useState(false);
  const [licenseAck, setLicenseAck] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [report, setReport] = useState<BulkPublishReport | null>(null);

  const selectedSet = new Set(selected);
  const allPageSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id));
  const canPublish = selected.length > 0 && editorialAck && licenseAck && !publishing;

  const toggleRow = (id: string): void => {
    if (selectedSet.has(id)) {
      setSelected(selected.filter((entry) => entry !== id));
    } else {
      setSelected([...selected, id]);
    }
  };

  const togglePage = (): void => {
    if (allPageSelected) {
      const pageIds = new Set(rows.map((row) => row.id));
      setSelected(selected.filter((id) => !pageIds.has(id)));
    } else {
      const merged = [...selected];

      for (const row of rows) {
        if (!selectedSet.has(row.id)) {
          merged.push(row.id);
        }
      }

      setSelected(merged);
    }
  };

  const handleFilter = async (): Promise<void> => {
    const jobId = jobFilter.trim() === "" ? null : jobFilter.trim();
    setLoading(true);
    setLoadError(null);

    try {
      const page = await loadCandidates({ cursor: "0", jobId, limit: CANDIDATE_PAGE_SIZE });
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setActiveJobId(jobId);
      setSelected([]);
      setReport(null);
    } catch {
      setLoadError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async (): Promise<void> => {
    if (nextCursor === null) {
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const page = await loadCandidates({
        cursor: nextCursor,
        jobId: activeJobId,
        limit: CANDIDATE_PAGE_SIZE,
      });

      setRows([...rows, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  const runPublish = async (ids: ReadonlyArray<string>): Promise<void> => {
    setPublishing(true);
    setPublishError(null);

    try {
      const outcome = await publishBatch({ ids, acks: { editorialAck, licenseAck } });
      const publishedIds = new Set(outcome.published.map((entry) => entry.id));
      setRows(rows.filter((row) => !publishedIds.has(row.id)));
      setSelected(selected.filter((id) => !publishedIds.has(id)));
      setReport(outcome);
    } catch {
      setPublishError(labels.publishFailed);
    } finally {
      setPublishing(false);
      setConfirmOpen(false);
    }
  };

  const handlePublishClick = (): void => {
    if (selected.length >= CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
    } else {
      void runPublish(selected);
    }
  };

  const handleRetryFailed = (): void => {
    if (report === null) {
      return;
    }

    const retryIds = report.failed.map((entry) => entry.id);

    if (retryIds.length === 0) {
      return;
    }

    void runPublish(retryIds);
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminCard>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="bulk-review-job-filter" className="text-sm font-semibold">
              {labels.jobFilterLabel}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="bulk-review-job-filter"
                value={jobFilter}
                onChange={(event) => {
                  setJobFilter(event.target.value);
                }}
                placeholder={labels.jobFilterPlaceholder}
                inputMode="numeric"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm text-ink"
              />
              <AdminGhostButton
                type="button"
                disabled={loading}
                onClick={() => void handleFilter()}
              >
                {labels.applyFilter}
              </AdminGhostButton>
              <AdminGhostButton
                type="button"
                disabled={loading || (jobFilter === "" && activeJobId === null)}
                onClick={() => {
                  setJobFilter("");
                  setActiveJobId(null);
                  setLoading(true);
                  setLoadError(null);
                  loadCandidates({ cursor: "0", jobId: null, limit: CANDIDATE_PAGE_SIZE })
                    .then((page) => {
                      setRows(page.items);
                      setNextCursor(page.nextCursor);
                      setSelected([]);
                      setReport(null);
                    })
                    .catch(() => {
                      setLoadError(labels.loadFailed);
                    })
                    .finally(() => {
                      setLoading(false);
                    });
                }}
              >
                {labels.clearFilter}
              </AdminGhostButton>
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">
              {labels.selectedCount(selected.length)}
            </legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editorialAck}
                onChange={(event) => {
                  setEditorialAck(event.target.checked);
                }}
                className="size-5 accent-brand-blue"
              />
              {labels.editorialAck}
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={licenseAck}
                onChange={(event) => {
                  setLicenseAck(event.target.checked);
                }}
                className="size-5 accent-brand-blue"
              />
              {labels.licenseAck}
            </label>
          </fieldset>
          <div>
            <AdminPrimaryButton
              type="button"
              disabled={!canPublish}
              aria-busy={publishing}
              onClick={handlePublishClick}
            >
              {publishing ? labels.publishing : labels.publishSelected}
            </AdminPrimaryButton>
          </div>
        </div>
      </AdminCard>

      {publishError !== null ? (
        <AdminErrorState
          message={publishError}
          retryLabel={labels.retry}
          onRetry={() => void runPublish(selected)}
          pending={publishing}
        />
      ) : null}

      {report !== null ? (
        <AdminCard>
          <div aria-live="polite" className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">
              {labels.publishedHeading(report.published.length)}
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {report.published.map((entry) => (
                <li key={entry.id}>
                  {entry.slug} <span className="text-muted">({entry.id})</span>
                </li>
              ))}
            </ul>
            {report.skipped.length > 0 ? (
              <>
                <h3 className="text-base font-bold">
                  {labels.skippedHeading(report.skipped.length)}
                </h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {report.skipped.map((entry) => (
                    <li key={entry.id}>
                      {entry.id} — {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.failed.length > 0 ? (
              <>
                <h3 className="text-base font-bold">
                  {labels.failedHeading(report.failed.length)}
                </h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {report.failed.map((entry) => (
                    <li key={entry.id}>
                      {entry.id} — {entry.reasons.join("; ")}
                    </li>
                  ))}
                </ul>
                <div>
                  <AdminGhostButton type="button" disabled={publishing} onClick={handleRetryFailed}>
                    {labels.retryFailed}
                  </AdminGhostButton>
                </div>
              </>
            ) : null}
          </div>
        </AdminCard>
      ) : null}

      {loadError !== null ? (
        <AdminErrorState
          message={loadError}
          retryLabel={labels.retry}
          onRetry={() => void handleLoadMore()}
          pending={loading}
        />
      ) : null}

      {rows.length === 0 ? (
        <AdminEmptyState message={labels.empty} />
      ) : (
        <AdminTable>
          <thead>
            <tr className="border-b border-border-soft bg-cream">
              <th scope="col" className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  aria-label={labels.selectAll}
                  onChange={togglePage}
                  className="size-5 accent-brand-blue"
                />
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {labels.dishColumn}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {labels.flagsColumn}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {labels.jobColumn}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border-soft last:border-0">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(row.id)}
                    aria-label={row.displayName ?? row.slug}
                    onChange={() => {
                      toggleRow(row.id);
                    }}
                    className="size-5 accent-brand-blue"
                  />
                </td>
                <td className="px-3 py-2 font-medium">
                  {row.displayName ?? row.slug}
                  <span className="block text-xs font-normal text-muted">{row.slug}</span>
                </td>
                <td className="px-3 py-2">
                  <ul className="flex flex-wrap gap-1">
                    {flagsFor(row, labels).map((flag) => (
                      <li
                        key={flag}
                        className="inline-block rounded-full border border-border-soft bg-cream px-2 py-0.5 text-xs font-semibold"
                      >
                        {flag}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2 text-sm text-muted">
                  {row.importJobId ?? "—"}
                  {row.importSourceName !== null ? ` · ${row.importSourceName}` : null}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}

      {nextCursor !== null && rows.length > 0 ? (
        <div>
          <AdminGhostButton
            type="button"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void handleLoadMore()}
          >
            {labels.loadMore}
          </AdminGhostButton>
        </div>
      ) : null}

      <AdminConfirmDialog
        open={confirmOpen}
        title={labels.confirmTitle(selected.length)}
        description={labels.confirmDescription(selected.length)}
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        dangerous={false}
        pending={publishing}
        onConfirm={() => void runPublish(selected)}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}
