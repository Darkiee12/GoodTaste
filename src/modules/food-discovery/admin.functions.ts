import { createServerFn } from "@tanstack/react-start";
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
import { InsufficientPermissions } from "@/server/auth/errors";
import type { PermissionRequest } from "@/server/auth/permissions";

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
] as const;

const requireSurface = async (
  loaded: Awaited<ReturnType<typeof loadServer>>,
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
  .validator(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }))
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
        effects.Effect.flatMap(AdminDashboardService, (service) => service.importJobs(data.limit)),
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
