import { randomUUID } from "node:crypto";

import { Effect } from "effect";
import { type z } from "zod";

import { scanReviewSchema } from "@/modules/restaurant-discovery/menu-scan.schema";
import { type MenuImport } from "@/modules/restaurant-discovery/restaurant.schema";
import {
  importMenu,
  reviewObservation,
  setMenuStatus,
  setOfferingStatus,
} from "@/modules/restaurant-discovery/server/operations/admin";
import {
  loadMenuScanDocument,
  ScanConflict,
  ScanInputError,
  ScanNotFound,
} from "@/modules/restaurant-discovery/server/operations/menu-scans";
import assetsQuery from "@/modules/restaurant-discovery/server/repository/sql/scan-assets.sql";
import contributionLock from "@/modules/restaurant-discovery/server/repository/sql/scan-contribution-lock.sql";
import contributionsQuery from "@/modules/restaurant-discovery/server/repository/sql/scan-contributions.sql";
import privateAssets from "@/modules/restaurant-discovery/server/repository/sql/scan-private-assets.sql";
import priorPromotion from "@/modules/restaurant-discovery/server/repository/sql/scan-promoted.sql";
import publicVenue from "@/modules/restaurant-discovery/server/repository/sql/scan-public-venue.sql";
import reviewContribution from "@/modules/restaurant-discovery/server/repository/sql/scan-review.sql";
import { Authorization, recordAuditEvent } from "@/modules/user/server/index";
import { Actor } from "@/server/auth/actor";
import { CurrentActor } from "@/server/auth/current-actor";
import { withTransaction } from "@/server/database/client";
import { runQuery } from "@/server/database/query";
import { PrivateMenuStorage } from "@/server/integrations/private-menu-storage";

const authorizeReview = Effect.gen(function* () {
  const actor = yield* CurrentActor;
  const authorization = yield* Authorization;
  yield* authorization.require(actor, { resource: "restaurant", actions: ["manage", "review"] });

  return yield* Actor.$match(actor, {
    Guest: () =>
      Effect.fail(
        new ScanInputError({ reason: "Sign in with permission to review menu contributions." }),
      ),
    Member: ({ userId }) => Effect.succeed(userId),
  });
});

const requireContribution = Effect.fn("menu.requireContribution")(function* (id: string) {
  const row = yield* runQuery("menu/contribution-lock", (sql) => contributionLock.run(sql, { id }));

  if (row === null) return yield* new ScanNotFound();

  return row;
});

export const listMenuContributions = () =>
  Effect.gen(function* () {
    yield* authorizeReview;

    return yield* runQuery("menu/contribution-queue", (sql) => contributionsQuery.run(sql));
  });

export const getMenuContribution = Effect.fn("menu.getContribution")(function* (id: string) {
  yield* authorizeReview;

  return yield* withTransaction(
    "menu/contribution-detail",
    Effect.gen(function* () {
      const contribution = yield* requireContribution(id);

      const assets = yield* runQuery("menu/contribution-assets", (sql) =>
        assetsQuery.run(sql, { session_id: contribution.session_id }),
      );

      const document = yield* loadMenuScanDocument(contribution.session_id, contribution.revision);

      return { contribution, assets, document };
    }),
  );
});

export const readContributionAsset = Effect.fn("menu.readContributionAsset")(function* (
  id: string,
  assetId: string,
) {
  yield* authorizeReview;

  const asset = yield* withTransaction(
    "menu/contribution-photo",
    Effect.gen(function* () {
      const contribution = yield* requireContribution(id);

      const assets = yield* runQuery("menu/contribution-private-assets", (sql) =>
        privateAssets.run(sql, { session_id: contribution.session_id }),
      );

      const selected = assets.find((entry) => entry.id === assetId);

      if (selected === undefined) return yield* new ScanNotFound();

      return selected;
    }),
  );

  const storage = yield* PrivateMenuStorage;

  return yield* storage.read(asset.object_key);
});

export const reviewMenuContribution = Effect.fn("menu.reviewContribution")(function* (
  request: z.infer<typeof scanReviewSchema>,
) {
  const actorId = yield* authorizeReview;
  const parsed = scanReviewSchema.safeParse(request);

  if (!parsed.success)
    return yield* new ScanInputError({
      reason: "Review the branch, observation dates, selected facts and notes before deciding.",
    });

  const input = parsed.data;

  return yield* withTransaction(
    "menu/review-contribution",
    Effect.gen(function* () {
      const contribution = yield* requireContribution(input.contributionId);

      if (contribution.status !== "pending") {
        if (contribution.status !== input.decision)
          return yield* new ScanConflict({
            reason: "Another reviewer already made a different decision.",
          });

        return {
          id: contribution.id,
          status: contribution.status,
          promoted_menu_id: contribution.promoted_menu_id,
        };
      }

      let menuId: string | null = null;

      if (input.decision === "approved") {
        if (input.venueId === null || input.itemIds.length === 0)
          return yield* new ScanInputError({
            reason:
              "Approval requires a confirmed restaurant branch and at least one reviewed item.",
          });

        const venueId = input.venueId;

        const venue = yield* runQuery("menu/review-venue", (sql) =>
          publicVenue.run(sql, { id: venueId }),
        );

        if (venue === null)
          return yield* new ScanInputError({
            reason: "Choose an existing public restaurant branch.",
          });

        const previous = yield* runQuery("menu/prior-promotion", (sql) =>
          priorPromotion.run(sql, { session_id: contribution.session_id }),
        );

        if (previous !== null)
          return yield* new ScanConflict({
            reason:
              "This scan already has a promoted menu. Add updates through the curated observation workflow.",
          });

        const observedAt = Date.parse(input.observedAt);
        const validUntil = Date.parse(input.validUntil);

        if (
          observedAt > Date.now() ||
          validUntil <= observedAt ||
          validUntil > observedAt + 365 * 86400000
        )
          return yield* new ScanInputError({
            reason:
              "Observation dates must be in the past with a review horizon of at most one year.",
          });

        const document = yield* loadMenuScanDocument(
          contribution.session_id,
          contribution.revision,
        );

        const assets = yield* runQuery("menu/promotion-assets", (sql) =>
          privateAssets.run(sql, { session_id: contribution.session_id }),
        );

        const source = assets[0];

        if (source === undefined)
          return yield* new ScanInputError({
            reason: "Original private photographs are required for review.",
          });

        const selectedItems = new Set(input.itemIds);
        const selectedPrices = new Set(input.pricedVariantIds);

        if (
          selectedItems.size !== input.itemIds.length ||
          selectedPrices.size !== input.pricedVariantIds.length
        )
          return yield* new ScanInputError({
            reason: "Each reviewed item or price may be selected only once.",
          });

        const items: MenuImport["items"] = [];
        const foundItems = new Set<string>();
        const foundPrices = new Set<string>();
        const assetIds = new Set(assets.map((asset) => asset.id));

        for (const item of document.items) {
          if (!selectedItems.has(item.id)) continue;

          if (item.sourceReferences.some((reference) => !assetIds.has(reference.assetId)))
            return yield* new ScanInputError({
              reason: "A selected item has missing private source evidence.",
            });

          foundItems.add(item.id);
          const variants: MenuImport["items"][number]["variants"] = [];

          for (const variant of item.variants) {
            const price = variant.price;
            let reviewedPrice: MenuImport["items"][number]["variants"][number]["price"];

            if (selectedPrices.has(variant.id)) {
              if (price === null || price.amount === null || price.currency === null)
                return yield* new ScanInputError({
                  reason: "A reviewed price needs a readable original amount and currency.",
                });

              reviewedPrice = {
                amount: price.amount,
                currency: price.currency,
                kind: "listed",
                channel: "dine_in",
                taxTreatment: price.taxTreatment,
                sourceLineKey: variant.id,
              };
              foundPrices.add(variant.id);
            }

            variants.push({
              name: variant.originalLabel === "" ? "As listed" : variant.originalLabel,
              price: reviewedPrice,
            });
          }

          items.push({
            name: item.originalName,
            description: item.originalDescription ?? "",
            matchKind: "suggestion",
            variants,
          });
        }

        if (foundItems.size !== selectedItems.size || foundPrices.size !== selectedPrices.size)
          return yield* new ScanInputError({
            reason:
              "Review selections must belong to this exact submitted revision and its selected items.",
          });

        const imported = yield* importMenu({
          venueId,
          menuName: document.menuTitle ?? "Reviewed menu",
          source: {
            category: "menu_photo",
            privateObjectKey: source.object_key,
            deduplicationKey: `menu-contribution:${contribution.id}`,
            restaurantVerified: false,
            observedAt: input.observedAt,
            validUntil: input.validUntil,
          },
          items,
        });

        for (const priceId of imported.priceIds)
          yield* reviewObservation({ kind: "price", id: priceId, status: "approved" });

        // Explicitly reviewed items can be published without prices. All variants
        // remain the reviewed source labels; no canonical dish match is inferred.
        for (const offering of imported.offeringIds) {
          yield* setOfferingStatus({ kind: "item", id: offering.itemId, status: "published" });
          yield* setOfferingStatus({
            kind: "variant",
            id: offering.variantId,
            status: "published",
          });
        }

        yield* setMenuStatus({ menuId: imported.menuId, status: "published" });
        menuId = imported.menuId;
      }

      const reviewed = yield* runQuery("menu/review-contribution", (sql) =>
        reviewContribution.run(sql, {
          id: contribution.id,
          status: input.decision,
          actor: actorId,
          notes: input.notes,
          menu_id: menuId,
        }),
      );

      if (reviewed === null)
        return yield* new ScanConflict({
          reason: "Another reviewer already decided this contribution.",
        });

      yield* recordAuditEvent({
        actorUserId: actorId,
        sessionId: null,
        requestId: randomUUID(),
        event: `restaurant.contribution.${input.decision}`,
        outcome: "succeeded",
        resource: contribution.id,
      });

      return reviewed;
    }),
  );
});
