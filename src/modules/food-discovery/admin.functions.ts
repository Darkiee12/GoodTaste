import { createServerFn } from "@tanstack/react-start";
import type { Effect } from "effect";
import type * as EffectModule from "effect";
import { z } from "zod";

import {
  adminDishesQuerySchema,
  adminImportApplySchema,
  adminImportUploadSchema,
  adminJobQuerySchema,
  adminReviewsQuerySchema,
  csvToRecords,
  jsonToRecords,
  MAX_IMPORT_FILE_BYTES,
  needsLicenseReview,
} from "@/modules/food-discovery/admin.schema";
import { localeSchema } from "@/modules/food-discovery/food.schema";
import type {
  DishMediaError,
  DishMediaRepository,
  DishMediaServiceApi,
  DishMediaStorage,
} from "@/modules/food-discovery/server/operations/dish-media-service";
import type * as AuthorizationModule from "@/modules/user/server/operations/authorization";
import type { Authorization } from "@/modules/user/server/operations/authorization";
import type { RoleRepository } from "@/modules/user/server/repository/role-repository";
import type * as ActorModule from "@/server/auth/actor";
import type { CurrentActor } from "@/server/auth/current-actor";
import { InsufficientPermissions } from "@/server/auth/errors";
import type { PermissionRequest } from "@/server/auth/permissions";
import type * as SessionModule from "@/server/auth/session";
import type { Database } from "@/server/database/client";
import type { TransactionFailed } from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";
import type * as RuntimeModule from "@/server/runtime";

/**
 * Food-discovery administration transport: dashboard stats, dish curation
 * lists, review queue, and the dataset import studio.
 *
 * Every handler resolves the actor from the verified session and enforces
 * current database grants at the server boundary. Route guards are
 * navigation hints only; these checks are the real authorization.
 *
 * Surface rule: the caller must hold at least one of `admin:access`,
 * `food:import`, or `moderation:read`. Each operation then enforces its
 * own resource permission (`food:read`, `moderation:read`, `food:import`).
 * Import mutations never run without `food:import`.
 */
const loadServer = async () => {
  const [effects, server, dashboard, authorization, session, actor, currentActor, runtime] =
    await Promise.all([
      import("effect"),
      import("@tanstack/react-start/server"),
      import("@/modules/food-discovery/server/operations/admin-dashboard-service"),
      import("@/modules/user/server/operations/authorization"),
      import("@/server/auth/session"),
      import("@/server/auth/actor"),
      import("@/server/auth/current-actor"),
      import("@/server/runtime"),
    ]);

  return {
    effects,
    server,
    dashboard,
    authorization,
    session,
    actor,
    currentActor,
    runtime,
  };
};

const SURFACE_CHECKS = [
  { resource: "admin", actions: ["access"] },
  { resource: "food", actions: ["import"] },
  { resource: "moderation", actions: ["read"] },
  { resource: "restaurant", actions: ["manage"] },
] as const;

const requireSurface = async (
  loaded: {
    readonly effects: typeof EffectModule;
    readonly authorization: typeof AuthorizationModule;
    readonly session: typeof SessionModule;
    readonly actor: typeof ActorModule;
    readonly runtime: typeof RuntimeModule;
  },
  headers: Headers,
  operation: string,
  requestId: string,
) => {
  const { effects, authorization, session, actor, runtime } = loaded;

  return runtime.runApp(
    effects.Effect.flatMap(session.requireAuthenticatedActor(headers), (trusted) => {
      const member = actor.Actor.Member({ userId: trusted.userId });

      return effects.Effect.flatMap(
        effects.Effect.forEach(SURFACE_CHECKS, (check) =>
          effects.Effect.flatMap(authorization.Authorization, (authz) => authz.has(member, check)),
        ),
        (results) =>
          results.some(Boolean)
            ? effects.Effect.succeed(trusted)
            : effects.Effect.fail(
                new InsufficientPermissions({
                  reason: "administration requires admin, import, or moderation grants",
                }),
              ),
      );
    }),
    operation,
    15000,
    requestId,
  );
};

const adminImportApplyWithApprovalsSchema = adminImportApplySchema.extend({
  approvals: z.object({
    licenseAck: z.boolean(),
    reviewAck: z.boolean(),
    duplicateRefs: z.array(z.string().min(1).max(300)),
  }),
});

const adminDishStatusUpdateSchema = z.object({
  dishId: z.string().regex(/^[0-9]+$/, "dish id must be a decimal id string"),
  status: z.enum(["draft", "review", "published", "archived"]),
});

const adminPublicationCheckSchema = z.object({
  dishId: z.string().regex(/^[0-9]+$/, "dish id must be a decimal id string"),
});

export const adminSurfaceFn = createServerFn({ method: "GET" }).handler(async () => {
  const loaded = await loadServer();
  const { server } = loaded;

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  return requireSurface(loaded, headers, "fn/admin/surface", requestId).then(
    () => ({ allowed: true as const }),
    () => ({ allowed: false as const }),
  );
});

export const adminDashboardStatsFn = createServerFn({ method: "GET" }).handler(async () => {
  const loaded = await loadServer();

  const {
    effects,
    server,
    dashboard: { AdminDashboardService },
    session,
    actor,
    currentActor,
    runtime,
  } = loaded;

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  await requireSurface(loaded, headers, "fn/admin/dashboard", requestId);

  const trusted = await runtime.runApp(
    session.requirePermission(headers, { resource: "food", actions: ["read"] }),
    "fn/admin/dashboard",
    15000,
    requestId,
  );

  return runtime.runApp(
    currentActor.withActor(
      actor.Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(AdminDashboardService, (service) => service.dashboardStats()),
    ),
    "fn/admin/dashboard",
    15000,
    requestId,
  );
});

export const adminDishesListFn = createServerFn({ method: "GET" })
  .validator(adminDishesQuerySchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/dishes", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["read"] }),
      "fn/admin/dishes",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.listDishes(data.status, BigInt(data.cursor), data.limit),
        ),
      ),
      "fn/admin/dishes",
      15000,
      requestId,
    );
  });

const dishDetailQuerySchema = z.object({
  dishId: z.string().min(1).max(200),
  locale: localeSchema,
});

export const adminDishDetailFn = createServerFn({ method: "GET" })
  .validator(dishDetailQuerySchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/dish-detail", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["read"] }),
      "fn/admin/dish-detail",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.dishDetail(data.dishId, data.locale),
        ),
      ),
      "fn/admin/dish-detail",
      15000,
      requestId,
    );
  });

export const adminReviewQueueFn = createServerFn({ method: "GET" })
  .validator(adminReviewsQuerySchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/reviews", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "moderation", actions: ["read"] }),
      "fn/admin/reviews",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.reviewQueue(data.limit, BigInt(data.cursor)),
        ),
      ),
      "fn/admin/reviews",
      15000,
      requestId,
    );
  });

export const adminImportJobsFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/import-jobs", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["import"] }),
      "fn/admin/import-jobs",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.importJobs(data.limit, data.offset),
        ),
      ),
      "fn/admin/import-jobs",
      15000,
      requestId,
    );
  });

export const adminImportJobDetailFn = createServerFn({ method: "GET" })
  .validator(adminJobQuerySchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/import-job", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["import"] }),
      "fn/admin/import-job",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.importJobDetail(data.jobId, data.recordLimit),
        ),
      ),
      "fn/admin/import-job",
      15000,
      requestId,
    );
  });

export const adminImportValidateFn = createServerFn({ method: "POST" })
  .validator(adminImportUploadSchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/import-validate", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["import"] }),
      "fn/admin/import-validate",
      15000,
      requestId,
    );

    let records: Array<unknown>;

    const contentBytes = Buffer.byteLength(data.contentText, "utf8");

    if (contentBytes > MAX_IMPORT_FILE_BYTES) {
      return {
        ok: false as const,
        reason: `file exceeds ${MAX_IMPORT_FILE_BYTES} byte limit (${contentBytes} bytes)`,
      };
    }

    try {
      const parsed =
        data.fileType === "json" ? jsonToRecords(data.contentText) : csvToRecords(data.contentText);

      if (parsed.length > 100) {
        return {
          ok: false as const,
          reason: `dataset has ${parsed.length} records; at most 100 per import job`,
        };
      }

      records = parsed;
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof Error ? error.message : "could not parse dataset file",
      };
    }

    const licenseReview = needsLicenseReview(data.sourceId, data.license);

    return runtime
      .runApp(
        currentActor.withActor(
          actor.Actor.Member({ userId: trusted.userId }),
          effects.Effect.flatMap(AdminDashboardService, (service) =>
            service.validateImport({
              sourceName: data.sourceName,
              payload: { source_name: data.sourceName, records },
              format: data.fileType,
              sourceUrl: data.sourceUrl ?? null,
              sourceVersion: data.sourceVersion ?? null,
              license: `${data.sourceId}:${data.license}`,
              attribution: data.attribution ?? null,
              editorialNotes: data.editorialNotes ?? null,
            }),
          ).pipe(
            effects.Effect.map((report) => ({
              ok: true as const,
              report,
              licenseReview,
            })),
            effects.Effect.catchTag("InvalidDishData", (failure) =>
              effects.Effect.succeed({ ok: false as const, reason: failure.reason }),
            ),
          ),
        ),
        "fn/admin/import-validate",
        60000,
        requestId,
      )
      .then((outcome) => outcome);
  });

export const adminImportApplyFn = createServerFn({ method: "POST" })
  .validator(adminImportApplyWithApprovalsSchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/import-apply", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["import"] }),
      "fn/admin/import-apply",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.applyImport({
            jobId: data.jobId,
            approvals: {
              licenseAck: data.approvals.licenseAck,
              reviewAck: data.approvals.reviewAck,
              duplicateRefs: data.approvals.duplicateRefs,
            },
            actorUserId: trusted.userId,
          }),
        ),
      ),
      "fn/admin/import-apply",
      60000,
      requestId,
    );
  });

export const adminUpdateDishStatusFn = createServerFn({ method: "POST" })
  .validator(adminDishStatusUpdateSchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/dish-status", requestId);

    const permission: PermissionRequest = { resource: "food", actions: ["publish"] };

    const trusted = await runtime.runApp(
      session.requirePermission(headers, permission),
      "fn/admin/dish-status",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.publishDish(trusted.userId, data.dishId, data.status),
        ),
      ),
      "fn/admin/dish-status",
      15000,
      requestId,
    );
  });

const loadMediaServer = async () => {
  const [effects, server, media, authorization, session, actor, currentActor, runtime] =
    await Promise.all([
      import("effect"),
      import("@tanstack/react-start/server"),
      import("@/modules/food-discovery/server/operations/dish-media-service"),
      import("@/modules/user/server/operations/authorization"),
      import("@/server/auth/session"),
      import("@/server/auth/actor"),
      import("@/server/auth/current-actor"),
      import("@/server/runtime"),
    ]);

  return { effects, server, media, authorization, session, actor, currentActor, runtime };
};

const dishMediaIdSchema = z.object({
  mediaId: z.string().regex(/^[0-9]+$/, "photo id must be a decimal id string"),
});

const dishMediaDishSchema = z.object({
  dishId: z.string().regex(/^[0-9]+$/, "dish id must be a decimal id string"),
});

const dishMediaFocalSchema = z.number().min(0).max(1).nullable().default(null);

const dishMediaMetadataFields = {
  altText: z.string().trim().max(500).nullable().default(null),
  attribution: z.string().trim().max(500).nullable().default(null),
  license: z.string().min(1).max(60),
  focalX: dishMediaFocalSchema,
  focalY: dishMediaFocalSchema,
  sourceUrl: z.string().trim().max(2000).nullable().default(null),
};

const dishMediaStageSchema = z.object({
  dishId: z.string().regex(/^[0-9]+$/, "dish id must be a decimal id string"),
  filename: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z.string().min(1).max(12_000_000),
  makePrimary: z.boolean().default(false),
  ...dishMediaMetadataFields,
});

const dishMediaMetadataSchema = z
  .object({ mediaId: dishMediaIdSchema.shape.mediaId, ...dishMediaMetadataFields })
  .strict();

const dishMediaReorderSchema = z.object({
  dishId: z.string().regex(/^[0-9]+$/, "dish id must be a decimal id string"),
  orderedIds: z
    .array(z.string().regex(/^[0-9]+$/))
    .min(1)
    .max(5),
});

type PhotoResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: string };

/**
 * Maps expected photo-domain failures to client-safe outcomes. Database,
 * permission, transaction, and session failures are not caught here: they
 * propagate as server-function errors (5xx/4xx) instead of masquerading as
 * photo reasons.
 */
const settlePhotoTask = <A, R>(
  effects: typeof EffectModule,
  task: Effect.Effect<A, DishMediaError, R>,
): Effect.Effect<PhotoResult<A>, DatabaseError | InsufficientPermissions | TransactionFailed, R> =>
  task.pipe(
    effects.Effect.map((value) => ({ ok: true as const, value })),
    effects.Effect.catchTags({
      DishMediaNotFound: () =>
        effects.Effect.succeed({ ok: false as const, reason: "photo not found" }),
      DishNotFound: () => effects.Effect.succeed({ ok: false as const, reason: "dish not found" }),
      DishMediaValidationFailed: (failure) =>
        effects.Effect.succeed({ ok: false as const, reason: failure.reason }),
      DishMediaConflict: (failure) =>
        effects.Effect.succeed({ ok: false as const, reason: failure.reason }),
      DishMediaLimitExceeded: () =>
        effects.Effect.succeed({
          ok: false as const,
          reason: "this dish already has the maximum of 5 photos",
        }),
      DishMediaPublishBlocked: (failure) =>
        effects.Effect.succeed({
          ok: false as const,
          reason:
            failure.reasons.length > 0 ? failure.reasons.join("; ") : "photo cannot be published",
        }),
      DishMediaStorageFailed: () =>
        effects.Effect.succeed({
          ok: false as const,
          reason: "photo storage failed; try again",
        }),
      DishMediaStorageMisconfigured: () =>
        effects.Effect.succeed({
          ok: false as const,
          reason: "photo storage is not configured",
        }),
    }),
  );

const withDishMediaService = async <A>(
  loaded: Awaited<ReturnType<typeof loadMediaServer>>,
  headers: Headers,
  permission: PermissionRequest,
  operation: string,
  requestId: string,
  task: (
    service: DishMediaServiceApi,
  ) => Effect.Effect<
    A,
    DishMediaError,
    | Database
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
  >,
): Promise<A> => {
  const { effects, session, actor, currentActor, runtime } = loaded;

  await requireSurface(loaded, headers, operation, requestId);

  const trusted = await runtime.runApp(
    session.requirePermission(headers, permission),
    operation,
    15000,
    requestId,
  );

  return runtime.runApp(
    effects.Effect.provide(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(loaded.media.DishMediaService, (service) => task(service)),
      ),
      loaded.media.DishMediaFullLive,
    ),
    operation,
    60000,
    requestId,
  );
};

export const listDishPhotosFn = createServerFn({ method: "GET" })
  .validator(dishMediaDishSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["read"] },
      "fn/admin/dish-photos",
      requestId,
      (service) => service.listForAdmin(data.dishId),
    );
  });

export const stageDishPhotoFn = createServerFn({ method: "POST" })
  .validator(dishMediaStageSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    let bytes: Uint8Array;

    try {
      bytes = new Uint8Array(Buffer.from(data.dataBase64, "base64"));
    } catch {
      return { ok: false as const, reason: "upload payload is not valid base64" };
    }

    if (bytes.byteLength === 0 || bytes.byteLength > 12_000_000) {
      return { ok: false as const, reason: "upload payload has an unexpected size" };
    }

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["import"] },
      "fn/admin/dish-photo-stage",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(
            effects,
            service.stagePhoto({
              dishId: data.dishId,
              bytes,
              filename: data.filename,
              altText: data.altText,
              attribution: data.attribution,
              license: data.license,
              focalX: data.focalX,
              focalY: data.focalY,
              sourceUrl: data.sourceUrl,
              makePrimary: data.makePrimary,
            }),
          ),
          (outcome) => (outcome.ok ? { ok: true as const, photo: outcome.value } : outcome),
        ),
    );
  });

export const updateDishPhotoMetadataFn = createServerFn({ method: "POST" })
  .validator(dishMediaMetadataSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["import"] },
      "fn/admin/dish-photo-metadata",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(
            effects,
            service.updateMetadata({
              mediaId: data.mediaId,
              altText: data.altText,
              attribution: data.attribution,
              license: data.license,
              focalX: data.focalX,
              focalY: data.focalY,
              sourceUrl: data.sourceUrl,
            }),
          ),
          (outcome) => (outcome.ok ? { ok: true as const, photo: outcome.value } : outcome),
        ),
    );
  });

export const reorderDishPhotosFn = createServerFn({ method: "POST" })
  .validator(dishMediaReorderSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["import"] },
      "fn/admin/dish-photos-reorder",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(
            effects,
            service.reorderPhotos({ dishId: data.dishId, orderedIds: data.orderedIds }),
          ),
          (outcome) => (outcome.ok ? { ok: true as const, photos: outcome.value } : outcome),
        ),
    );
  });

export const submitDishPhotoForReviewFn = createServerFn({ method: "POST" })
  .validator(dishMediaIdSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["import"] },
      "fn/admin/dish-photo-review",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(effects, service.submitForReview(data.mediaId)),
          (outcome) => (outcome.ok ? { ok: true as const, photo: outcome.value } : outcome),
        ),
    );
  });

export const publishDishPhotoFn = createServerFn({ method: "POST" })
  .validator(dishMediaIdSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["publish"] },
      "fn/admin/dish-photo-publish",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(effects, service.publishPhoto(data.mediaId)),
          (outcome) => (outcome.ok ? { ok: true as const, photo: outcome.value } : outcome),
        ),
    );
  });

export const returnDishPhotoToDraftFn = createServerFn({ method: "POST" })
  .validator(dishMediaIdSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["import"] },
      "fn/admin/dish-photo-draft",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(effects, service.returnToDraft(data.mediaId)),
          (outcome) => (outcome.ok ? { ok: true as const, photo: outcome.value } : outcome),
        ),
    );
  });

export const removeDishPhotoFn = createServerFn({ method: "POST" })
  .validator(dishMediaIdSchema)
  .handler(async ({ data }) => {
    const loaded = await loadMediaServer();
    const { effects, server } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return withDishMediaService(
      loaded,
      headers,
      { resource: "food", actions: ["import"] },
      "fn/admin/dish-photo-delete",
      requestId,
      (service) =>
        effects.Effect.map(
          settlePhotoTask(effects, service.removePhoto(data.mediaId)),
          (outcome) => (outcome.ok ? { ok: true as const, deleted: outcome.value } : outcome),
        ),
    );
  });

export const adminPublicationCheckFn = createServerFn({ method: "GET" })
  .validator(adminPublicationCheckSchema)
  .handler(async ({ data }) => {
    const loaded = await loadServer();

    const {
      effects,
      server,
      dashboard: { AdminDashboardService },
      session,
      actor,
      currentActor,
      runtime,
    } = loaded;

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    await requireSurface(loaded, headers, "fn/admin/publication-check", requestId);

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "food", actions: ["read"] }),
      "fn/admin/publication-check",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(AdminDashboardService, (service) =>
          service.publicationCheck(data.dishId),
        ),
      ),
      "fn/admin/publication-check",
      15000,
      requestId,
    );
  });
