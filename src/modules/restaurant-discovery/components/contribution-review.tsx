import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { menuScanClient } from "@/modules/restaurant-discovery/menu-scan-client";
import { channelSchema } from "@/modules/restaurant-discovery/restaurant.schema";

const rootRoute = getRouteApi("__root__");
const toISODate = (value: string): string => new Date(`${value}T00:00:00Z`).toISOString();
const todayInput = (): string => new Date().toISOString().slice(0, 10);

function toggleIds(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);

  if (next.has(id)) next.delete(id);
  else next.add(id);

  return next;
}

function ContributionDetail({
  contributionId,
  ownerId,
  onDone,
}: {
  readonly contributionId: string;
  readonly ownerId: string;
  readonly onDone: () => void;
}) {
  const [itemIds, setItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pricedIds, setPricedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [venueId, setVenueId] = useState("");
  const [observedAt, setObservedAt] = useState(todayInput);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [channel, setChannel] = useState("");
  const [rightsReviewed, setRightsReviewed] = useState(false);

  const detail = useQuery({
    queryKey: ["menu-contribution", ownerId, contributionId],
    queryFn: ({ signal }) => menuScanClient.contribution(contributionId, signal),
    retry: false,
  });

  const review = useMutation({
    mutationFn: (decision: "approved" | "rejected") => {
      const selectedChannel = channelSchema.safeParse(channel);

      if (decision === "approved" && !selectedChannel.success)
        throw new Error("Choose the confirmed sales channel before recording a decision.");

      const horizon =
        validUntil === "" ? detail.data?.contribution.expires_at.slice(0, 10) : validUntil;

      if (horizon === undefined)
        throw new Error("Reload the contribution before recording a decision.");

      return menuScanClient.review({
        contributionId,
        decision,
        venueId: venueId === "" ? null : venueId,
        observedAt: toISODate(observedAt),
        validUntil: toISODate(horizon),
        notes,
        channel: selectedChannel.success ? selectedChannel.data : null,
        rightsReviewed,
        itemIds: [...itemIds],
        pricedVariantIds: [...pricedIds],
      });
    },
    onSuccess: onDone,
  });

  if (detail.isPending) return <p aria-live="polite">Loading contribution…</p>;

  if (detail.isError) return <p role="alert">{detail.error.message}</p>;
  const { contribution, document, assets, duplicates } = detail.data;

  const duplicateCounts = new Map(
    duplicates.map((entry) => [entry.asset_id, entry.contribution_count]),
  );

  const sourceLanguage = document.sourceLanguage ?? "und";
  const horizon = validUntil === "" ? contribution.expires_at.slice(0, 10) : validUntil;

  return (
    <article className="discovery-card">
      <h3>
        Contribution {contribution.id.slice(0, 8)} · {contribution.status} · revision{" "}
        {contribution.revision}
      </h3>
      <p className="text-sm">
        Consented {contribution.consented_at.slice(0, 10)} under {contribution.consent_terms}.
        Private photographs and drafts expire {contribution.expires_at.slice(0, 10)}.
        {contribution.requested_venue_id !== null &&
          ` Requested branch: ${contribution.requested_venue_id}.`}
      </p>
      <p>
        Original language: {document.sourceLanguage ?? "unknown"}; translated into{" "}
        {document.targetLanguage}. Customer corrections and model interpretations require
        independent review. Approval does not verify restaurant ownership.
      </p>
      <div className="grid gap-2">
        {assets.map((asset) => {
          const photoUrl = `/api/menu-scans?contributionId=${contribution.id}&assetId=${asset.id}`;
          const duplicateCount = duplicateCounts.get(asset.id) ?? 0;

          return (
            <figure key={asset.id}>
              <a href={photoUrl} target="_blank" rel="noreferrer">
                <img
                  src={photoUrl}
                  alt={`Menu evidence page ${asset.page_number}`}
                  loading="lazy"
                  className="max-h-64 max-w-full"
                />
                Open full-size evidence page {asset.page_number}
              </a>
              {duplicateCount > 0 && (
                <figcaption>
                  Matching photograph in {duplicateCount} other retained contribution(s). Verify the
                  branch and observation date independently; this does not establish the same menu.
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
      {contribution.status === "pending" && (
        <>
          <fieldset>
            <legend>Reviewed facts (approval promotes checked items and prices)</legend>
            {document.items.map((item) => (
              <div key={item.id} className="my-4 border-b border-border-soft pb-4">
                <label>
                  <input
                    type="checkbox"
                    checked={itemIds.has(item.id)}
                    disabled={review.isPending}
                    onChange={() => {
                      setItemIds((previous) => toggleIds(previous, item.id));

                      if (itemIds.has(item.id)) {
                        const removedIds = new Set(item.variants.map((variant) => variant.id));
                        setPricedIds(
                          (previous) => new Set([...previous].filter((id) => !removedIds.has(id))),
                        );
                      }
                    }}
                  />
                  <span lang={sourceLanguage}>{item.originalName}</span>
                  {item.translatedName !== null && (
                    <span lang={document.targetLanguage}> / {item.translatedName}</span>
                  )}
                </label>
                {item.customerAdded === true && (
                  <p>Added by the customer; verify against the photograph.</p>
                )}
                {item.originalDescription !== null && (
                  <p>
                    Original description:{" "}
                    <span lang={sourceLanguage}>{item.originalDescription}</span>
                  </p>
                )}
                {item.translatedDescription !== null && (
                  <p>
                    Translated description:{" "}
                    <span lang={document.targetLanguage}>{item.translatedDescription}</span>
                  </p>
                )}
                {item.explanatorySummary !== null && (
                  <p>
                    Interpretation, not printed text:{" "}
                    <span lang={document.targetLanguage}>{item.explanatorySummary}</span>
                  </p>
                )}
                {item.ingredients !== null && item.ingredients.length > 0 && (
                  <ul>
                    {item.ingredients.map((ingredient) => (
                      <li key={`${ingredient.evidence}:${ingredient.originalText}`}>
                        {ingredient.evidence === "printed"
                          ? "Printed ingredient"
                          : "Inferred ingredient"}
                        : <span lang={sourceLanguage}>{ingredient.originalText}</span>
                        {ingredient.translatedText !== null && (
                          <span lang={document.targetLanguage}> / {ingredient.translatedText}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {item.uncertainties.length > 0 && (
                  <p>Please resolve: {item.uncertainties.join("; ")}</p>
                )}
                <p className="text-sm">
                  Evidence pages:{" "}
                  {item.sourceReferences
                    .map(
                      (reference) =>
                        assets.find((asset) => asset.id === reference.assetId)?.page_number ?? "?",
                    )
                    .join(", ")}
                </p>
                <ul>
                  {item.variants.map((variant) => {
                    const price = variant.price;

                    const priceable =
                      price !== null && price.amount !== null && price.currency !== null;

                    return (
                      <li key={variant.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={pricedIds.has(variant.id)}
                            disabled={review.isPending || !priceable || !itemIds.has(item.id)}
                            onChange={() =>
                              setPricedIds((previous) => toggleIds(previous, variant.id))
                            }
                          />
                          <span lang={sourceLanguage}>
                            {variant.originalLabel === ""
                              ? "No printed variant label"
                              : variant.originalLabel}
                          </span>
                          {variant.translatedLabel !== null && (
                            <span lang={document.targetLanguage}> / {variant.translatedLabel}</span>
                          )}
                          {price === null
                            ? " · no price"
                            : ` · printed: ${price.rawText}; exact: ${price.amount ?? "unknown"} ${price.currency ?? "unknown currency"}; tax: ${price.taxTreatment}`}
                        </label>
                        {variant.customerAdded === true && <p>Variant added by the customer.</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </fieldset>
          <p>
            Checking an item approves its displayed original and translated text and all its variant
            labels. Check each price separately. Ingredient interpretations never establish dietary
            safety.
          </p>
          <label htmlFor={`review-venue-${contribution.id}`}>Confirmed branch ID</label>
          <input
            id={`review-venue-${contribution.id}`}
            value={venueId}
            disabled={review.isPending}
            maxLength={36}
            onChange={(event) => setVenueId(event.target.value)}
          />
          <label htmlFor={`review-channel-${contribution.id}`}>Confirmed sales channel</label>
          <select
            id={`review-channel-${contribution.id}`}
            value={channel}
            disabled={review.isPending}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="">Choose the observed channel</option>
            <option value="dine_in">Dine-in</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
          </select>
          <label htmlFor={`review-observed-${contribution.id}`}>Observed date</label>
          <input
            id={`review-observed-${contribution.id}`}
            type="date"
            value={observedAt}
            disabled={review.isPending}
            onChange={(event) => setObservedAt(event.target.value)}
          />
          <label htmlFor={`review-valid-${contribution.id}`}>
            Review again by (before private evidence expires)
          </label>
          <input
            id={`review-valid-${contribution.id}`}
            type="date"
            value={horizon}
            max={contribution.expires_at.slice(0, 10)}
            disabled={review.isPending}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          <label htmlFor={`review-notes-${contribution.id}`}>Review notes (required)</label>
          <textarea
            id={`review-notes-${contribution.id}`}
            value={notes}
            disabled={review.isPending}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
          />
          <label className="my-3 flex gap-2">
            <input
              type="checkbox"
              checked={rightsReviewed}
              disabled={review.isPending}
              onChange={(event) => setRightsReviewed(event.target.checked)}
            />
            I checked these photographs for personal data and rights to retain them as private
            evidence within the consented period.
          </label>
          <div className="discovery-card-actions">
            <button
              type="button"
              disabled={
                review.isPending ||
                itemIds.size === 0 ||
                channel === "" ||
                !rightsReviewed ||
                notes.trim() === ""
              }
              onClick={() => review.mutate("approved")}
            >
              Approve selected facts
            </button>
            <button
              type="button"
              className="secondary"
              disabled={review.isPending || notes.trim() === ""}
              onClick={() => review.mutate("rejected")}
            >
              Reject submission
            </button>
          </div>
        </>
      )}
      {review.isError && (
        <p className="discovery-message" role="alert">
          {review.error.message}
        </p>
      )}
    </article>
  );
}

export function ContributionReview({ canReview }: { readonly canReview: boolean }) {
  const client = useQueryClient();
  const { session } = rootRoute.useRouteContext();
  const ownerId = session.status === "signed-in" ? session.user.id : null;
  const [selected, setSelected] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["menu-contributions", ownerId],
    queryFn: ({ signal }) => menuScanClient.queue(signal),
    enabled: canReview && ownerId !== null,
    retry: false,
  });

  if (!canReview || ownerId === null) return null;

  const reload = (): void => {
    setSelected(null);
    void client.invalidateQueries({ queryKey: ["menu-contributions", ownerId] });
  };

  return (
    <section>
      <h2>Menu scan contributions</h2>
      <p className="my-3 text-sm text-muted">
        Private submissions awaiting review. Inspect photographs, branch identity, source date,
        original and translated text, portions, exact prices and rights before approving selected
        facts. Photographs remain private. Reviewed facts may remain after the consented evidence
        retention period.
      </p>
      <button type="button" disabled={queue.isFetching} onClick={reload}>
        Reload contribution queue
      </button>
      {queue.isPending && <p aria-live="polite">Loading queue…</p>}
      {queue.isError && (
        <p className="discovery-message" role="alert">
          {queue.error.message}
        </p>
      )}
      {queue.data !== undefined && queue.data.length === 0 && <p>No pending contributions.</p>}
      <ul className="grid gap-3">
        {(queue.data ?? []).map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              aria-expanded={selected === entry.id}
              onClick={() => setSelected(selected === entry.id ? null : entry.id)}
            >
              {entry.id.slice(0, 8)} · {entry.venue_name ?? "unknown branch"} · revision{" "}
              {entry.revision} · {entry.consented_at.slice(0, 10)}
            </button>
            {selected === entry.id && (
              <ContributionDetail
                key={`${ownerId}:${entry.id}`}
                contributionId={entry.id}
                ownerId={ownerId}
                onDone={reload}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
