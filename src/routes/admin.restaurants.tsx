import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { DiscoveryError } from "@/modules/restaurant-discovery/components/discovery-error";
import {
  importMenuFn,
  restaurantAdminFn,
  reviewRestaurantFn,
  setMenuStatusFn,
  setOfferingStatusFn,
  writeVenueFn,
} from "@/modules/restaurant-discovery/restaurant.functions";
import {
  menuImportSchema,
  menuStatusSchema,
  offeringStatusSchema,
  venueWriteSchema,
} from "@/modules/restaurant-discovery/restaurant.schema";

export const Route = createFileRoute("/admin/restaurants")({
  loader: () => restaurantAdminFn(),
  errorComponent: DiscoveryError,
  component: RestaurantAdmin,
});

function RestaurantAdmin() {
  const { venues, queue, canReview } = Route.useLoaderData();
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [lastImport, setLastImport] = useState("");
  const [busy, setBusy] = useState(false);
  const venue = venues.find((entry) => entry.id === selected);

  const run = async <A,>(action: () => Promise<A>, success: string): Promise<void> => {
    setBusy(true);
    setMessage("");

    try {
      await action();
      setMessage(success);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action failed. Retry.");
    } finally {
      setBusy(false);
    }
  };

  const saveVenue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const cuisines = z.string().safeParse(values.cuisines);

    if (!cuisines.success) {
      setMessage("Cuisine IDs must be text.");

      return;
    }

    const parsed = venueWriteSchema.safeParse({
      ...values,
      venueId: selected || undefined,
      businessId: values.businessId || undefined,
      longitude: Number(values.longitude),
      latitude: Number(values.latitude),
      cuisineIds: cuisines.data
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    });

    if (!parsed.success) {
      setMessage(parsed.error.issues.map((issue) => issue.message).join(". "));

      return;
    }

    void run(
      () => writeVenueFn({ data: parsed.data }),
      "Venue saved. Menu and serving claims still require separate review.",
    );
  };

  const importSource = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = z.string().safeParse(new FormData(event.currentTarget).get("payload"));

    if (!raw.success) {
      setMessage("Enter a JSON menu payload.");

      return;
    }

    let parsed;

    try {
      parsed = menuImportSchema.safeParse(JSON.parse(raw.data));
    } catch {
      setMessage("Enter valid JSON in the documented menu format.");

      return;
    }

    if (!parsed.success) {
      setMessage(parsed.error.issues.map((issue) => issue.message).join(". "));

      return;
    }

    void run(async () => {
      const result = await importMenuFn({ data: parsed.data });
      setLastImport(JSON.stringify(result, null, 2));
      setSelected(parsed.data.venueId);

      return result;
    }, "Source imported transactionally. Prices and dish matches are pending review below.");
  };

  const template = JSON.stringify(
    {
      venueId: selected,
      menuName: "",
      source: {
        category: "official_menu",
        url: "",
        deduplicationKey: "",
        restaurantVerified: false,
        observedAt: "",
        validUntil: "",
      },
      items: [{ name: "", variants: [{ name: "As listed" }] }],
    },
    null,
    2,
  );

  return (
    <section className="discovery-page" lang="en">
      <header>
        <p className="discovery-eyebrow">Editorial workspace</p>
        <h1>Restaurants & menus</h1>
        <p>
          Record real branches and source observations. Imported prices and serving matches remain
          pending until reviewed.
        </p>
      </header>
      <label htmlFor="edit-venue">Edit a branch or add one</label>
      <select
        id="edit-venue"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">New venue</option>
        {venues.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name} · {entry.area} · {entry.status}
          </option>
        ))}
      </select>
      <form key={selected} className="restaurant-filters" onSubmit={saveVenue}>
        <div>
          <label htmlFor="business-name">Business name</label>
          <input
            id="business-name"
            name="businessName"
            defaultValue={venue?.name ?? ""}
            required
            maxLength={300}
          />
        </div>
        <div>
          <label htmlFor="business-id">Existing business ID (for another branch)</label>
          <input id="business-id" name="businessId" defaultValue={venue?.business_id ?? ""} />
        </div>
        <div>
          <label htmlFor="venue-name">Branch display name</label>
          <input
            id="venue-name"
            name="name"
            defaultValue={venue?.name ?? ""}
            required
            maxLength={300}
          />
        </div>
        <div>
          <label htmlFor="venue-address">Address</label>
          <input
            id="venue-address"
            name="address"
            defaultValue={venue?.address ?? ""}
            required
            maxLength={1000}
          />
        </div>
        <div>
          <label htmlFor="venue-area">City / area</label>
          <input
            id="venue-area"
            name="area"
            defaultValue={venue?.area ?? ""}
            required
            maxLength={200}
          />
        </div>
        <div>
          <label htmlFor="venue-country">Country ISO code</label>
          <input
            id="venue-country"
            name="countryCode"
            defaultValue={venue?.country_code ?? ""}
            required
            pattern="[A-Z]{2}"
            maxLength={2}
          />
        </div>
        <div>
          <label htmlFor="venue-longitude">Longitude</label>
          <input
            id="venue-longitude"
            name="longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            defaultValue={venue?.longitude}
            required
          />
        </div>
        <div>
          <label htmlFor="venue-latitude">Latitude</label>
          <input
            id="venue-latitude"
            name="latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            defaultValue={venue?.latitude}
            required
          />
        </div>
        <div>
          <label htmlFor="venue-status">Visibility</label>
          <select id="venue-status" name="status" defaultValue={venue?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label htmlFor="venue-cuisines">Curated cuisine IDs (comma separated)</label>
          <input
            id="venue-cuisines"
            name="cuisines"
            defaultValue={venue?.cuisine_ids.join(", ") ?? ""}
            aria-describedby="cuisine-warning"
          />
        </div>
        <p id="cuisine-warning" className="filter-help">
          Cuisine is a filter, never evidence that a dish is served. Saving replaces this branch’s
          cuisine selection.
        </p>
        <button type="submit" disabled={busy}>
          Save venue
        </button>
      </form>
      {message !== "" && (
        <p className="discovery-message" aria-live="polite">
          {message}
        </p>
      )}
      <section>
        <h2>Official menu entry / structured import</h2>
        <p className="my-3 text-sm text-muted">
          Supply source URL or private object reference, a stable snapshot deduplication key, actual
          observation date and review horizon. Add exact decimal strings to variant price fields.
          Reuse menuId, itemId and variantId to append a new price observation to an existing
          offering. No OCR or public file upload is performed here.
        </p>
        <form className="grid gap-3" onSubmit={importSource}>
          <label htmlFor="menu-payload">Menu JSON (required fields start blank)</label>
          <textarea
            key={selected}
            id="menu-payload"
            name="payload"
            rows={18}
            defaultValue={template}
            spellCheck={false}
            required
            className="font-mono text-sm"
          />
          <button type="submit" disabled={busy || selected === ""}>
            Import pending observations
          </button>
        </form>
        {selected !== "" && (
          <details className="mt-4">
            <summary className="cursor-pointer font-semibold">Price field reference</summary>
            <pre className="overflow-x-auto rounded-lg bg-white p-4 text-xs">
              {JSON.stringify(
                {
                  name: "As listed",
                  comparisonKey: "regular-bowl",
                  price: {
                    amount: "",
                    currency: "",
                    kind: "listed",
                    channel: "dine_in",
                    taxTreatment: "unknown",
                    sourceLineKey: "",
                  },
                },
                null,
                2,
              )}
            </pre>
            <p className="text-sm">
              For serving evidence, add the canonical dishId and matchKind (exact, variant or
              suggestion) to an item. Suggestions cannot be approved.
            </p>
          </details>
        )}
      </section>
      {lastImport !== "" && (
        <details open>
          <summary>Imported record IDs (retain for later observations)</summary>
          <pre className="overflow-x-auto bg-white p-4 text-xs">{lastImport}</pre>
        </details>
      )}
      <section>
        <h2>Menu visibility</h2>
        <form
          className="discovery-search-bar"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);

            const parsed = menuStatusSchema.safeParse({
              menuId: form.get("menuId"),
              status: "archived",
            });

            if (parsed.success)
              void run(
                () => setMenuStatusFn({ data: parsed.data }),
                "Menu archived. Historical observations are retained.",
              );
            else setMessage("Enter a valid menu ID.");
          }}
        >
          <label htmlFor="archive-menu">Menu ID to archive</label>
          <input id="archive-menu" name="menuId" required />
          <button type="submit" disabled={busy}>
            Archive menu
          </button>
        </form>
      </section>
      <section>
        <h2>Observation review and history</h2>
        <form
          className="restaurant-filters"
          onSubmit={(event) => {
            event.preventDefault();

            const parsed = offeringStatusSchema.safeParse(
              Object.fromEntries(new FormData(event.currentTarget)),
            );

            if (!parsed.success) {
              setMessage("Choose an offering type and valid item/variant ID.");

              return;
            }

            void run(
              () => setOfferingStatusFn({ data: parsed.data }),
              "Offering visibility updated; its price history is retained.",
            );
          }}
        >
          <div>
            <label htmlFor="offering-kind">Offering type</label>
            <select id="offering-kind" name="kind">
              <option value="item">Menu item</option>
              <option value="variant">Variant</option>
            </select>
          </div>
          <div>
            <label htmlFor="offering-id">Item / variant ID</label>
            <input id="offering-id" name="id" required />
          </div>
          <div>
            <label htmlFor="offering-status">Visibility</label>
            <select id="offering-status" name="status">
              <option value="archived">Archived</option>
              <option value="published">Published</option>
            </select>
          </div>
          <button type="submit" disabled={busy}>
            Update offering
          </button>
        </form>
        <p className="my-3 text-sm text-muted">
          Review source, branch, portion, channel, tax treatment and observation date. Conflicting
          records stay in history; an approval never deletes an earlier price. Showing the latest
          200 observations.
        </p>
        <ul className="grid gap-3">
          {queue.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className="discovery-card">
              <h3>
                {entry.venue} · {entry.item}
                {entry.variant !== null && ` · ${entry.variant}`}
              </h3>
              <p>
                {entry.kind} · {entry.detail} · {entry.amount} {entry.currency} ·{" "}
                {entry.review_status}
              </p>
              <p className="text-sm">
                {entry.source_category} · restaurant verified: {String(entry.restaurant_verified)} ·
                observed {entry.observed_at.slice(0, 10)} · review after{" "}
                {entry.review_after.slice(0, 10)}
              </p>
              <p className="text-sm">
                {entry.sales_channel} · tax {entry.tax_treatment}
                {entry.quantity !== null &&
                  ` · receipt quantity ${entry.quantity}, explicit paid unit ${entry.explicit_unit_price}, line total ${entry.line_total}, discount ${entry.discount}, taxes/fees ${entry.taxes_fees}, ${entry.total_semantics}`}
              </p>
              {entry.source_url !== null && (
                <a href={entry.source_url} target="_blank" rel="noreferrer">
                  Review source
                </a>
              )}
              {canReview && (
                <div className="discovery-card-actions">
                  <button
                    type="button"
                    disabled={busy || entry.detail.startsWith("suggestion")}
                    onClick={() =>
                      void run(
                        () =>
                          reviewRestaurantFn({
                            data: {
                              id: entry.id,
                              kind: entry.kind === "price" ? "price" : "serving",
                              status: "approved",
                            },
                          }),
                        "Observation approved.",
                      )
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          reviewRestaurantFn({
                            data: {
                              id: entry.id,
                              kind: entry.kind === "price" ? "price" : "serving",
                              status: "rejected",
                            },
                          }),
                        "Observation rejected.",
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
