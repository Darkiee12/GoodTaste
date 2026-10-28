import { Context, Effect, Layer } from "effect";

import type { DishProfile } from "@/modules/food-discovery/server/domain/dish";
import { DishNotFound } from "@/modules/food-discovery/server/domain/errors";
import { isDbIdString } from "@/modules/food-discovery/server/domain/ids";
import {
  type AdminServiceError,
  AdminService,
} from "@/modules/food-discovery/server/operations/admin-service";
import {
  type CatalogImportError,
  CatalogImportService,
  type ImportApplyInput,
  type ImportApplyReport,
  type ImportValidateInput,
  type ImportValidationReport,
} from "@/modules/food-discovery/server/operations/catalog-import-service";
import {
  CurationService,
  type CurationServiceError,
  type PublicationCheck,
} from "@/modules/food-discovery/server/operations/curation-service";
import {
  DishService,
  type DishServiceError,
} from "@/modules/food-discovery/server/operations/dish-service";
import {
  type AdminImportJobRecentRow,
  type AdminImportJobRow,
  type AdminImportJobStatusRow,
  type AdminImportRecordRow,
  CurationRepository,
} from "@/modules/food-discovery/server/repository/curation-repository";
import {
  type AdminDishRecentRow,
  type AdminDishRow,
  DishRepository,
} from "@/modules/food-discovery/server/repository/dish-repository";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";

export type AdminDashboardError =
  | CatalogImportError
  | CurationServiceError
  | DishServiceError
  | DatabaseError;

export interface DashboardStats {
  readonly dishCounts: {
    readonly published: number;
    readonly review: number;
    readonly draft: number;
    readonly archived: number;
  };
  readonly missingIngredients: number;
  readonly importByStatus: ReadonlyArray<AdminImportJobStatusRow>;
  readonly recentDishes: ReadonlyArray<AdminDishRecentRow>;
  readonly recentJobs: ReadonlyArray<AdminImportJobRecentRow>;
}

/**
 * Read-mostly administration surface. Every method assumes the transport
 * already enforced `food:read`/`moderation:read`/`food:import` against
 * current database grants; the service performs no additional policy.
 * All rows come from purpose-specific SQL projections (string IDs for
 * JSON), so results pass through without mapping.
 */
export class AdminDashboardService extends Context.Service<
  AdminDashboardService,
  {
    readonly dashboardStats: () => Effect.Effect<
      DashboardStats,
      DatabaseError,
      Database | DishRepository | CurationRepository
    >;
    readonly listDishes: (
      status: string,
      cursor: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AdminDishRow>, DatabaseError, Database | DishRepository>;
    readonly dishDetail: (
      dishId: string,
      locale: string,
    ) => Effect.Effect<
      {
        readonly dish: DishProfile;
        readonly notes: ReadonlyArray<{
          readonly id: string;
          readonly author: string;
          readonly noteKind: string;
          readonly note: string;
          readonly createdAt: string;
        }>;
        readonly revisions: ReadonlyArray<{
          readonly id: string;
          readonly actor: string;
          readonly operation: string;
          readonly summary: string;
          readonly createdAt: string;
        }>;
      },
      AdminDashboardError,
      Database | DishService | CurationService
    >;
    readonly reviewQueue: (
      limit: number,
      cursor: bigint,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: string; readonly slug: string; readonly status: string }>,
      CurationServiceError,
      Database | CurationService
    >;
    readonly importJobs: (
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<AdminImportJobRecentRow>,
      DatabaseError,
      Database | CurationRepository
    >;
    readonly importJobDetail: (
      jobId: string,
      recordLimit: number,
    ) => Effect.Effect<
      { readonly job: AdminImportJobRow; readonly records: ReadonlyArray<AdminImportRecordRow> },
      AdminDashboardError,
      Database | CurationRepository
    >;
    readonly validateImport: (
      input: ImportValidateInput,
    ) => Effect.Effect<ImportValidationReport, CatalogImportError, Database | CatalogImportService>;
    readonly applyImport: (
      input: ImportApplyInput,
    ) => Effect.Effect<ImportApplyReport, CatalogImportError, Database | CatalogImportService>;
    readonly publishDish: (
      userId: string,
      dishId: string,
      status: string,
    ) => Effect.Effect<
      { readonly id: string; readonly status: string },
      AdminServiceError,
      Database | AdminService
    >;
    readonly publicationCheck: (
      dishId: string,
    ) => Effect.Effect<PublicationCheck, CurationServiceError, Database | CurationService>;
  }
>()("feastjourney/food-discovery/AdminDashboardService") {}

export const AdminDashboardServiceLive = Layer.effect(
  AdminDashboardService,
  Effect.gen(function* () {
    const dishes = yield* DishRepository;
    const curation = yield* CurationRepository;
    const dishService = yield* DishService;
    const curationService = yield* CurationService;
    const importService = yield* CatalogImportService;
    const adminService = yield* AdminService;

    return AdminDashboardService.of({
      dashboardStats: () =>
        Effect.gen(function* () {
          const [published, review, draft, archived, missingIngredients, importByStatus] =
            yield* Effect.all(
              [
                dishes.countByStatus("published"),
                dishes.countByStatus("review"),
                dishes.countByStatus("draft"),
                dishes.countByStatus("archived"),
                dishes.missingIngredientsCount(),
                curation.importJobsByStatus(),
              ],
              { concurrency: 2 },
            );

          const [recentDishes, recentJobs] = yield* Effect.all(
            [dishes.recentAdminDishes(8), curation.recentImportJobs(8)],
            { concurrency: 2 },
          );

          return {
            dishCounts: { published, review, draft, archived },
            missingIngredients,
            importByStatus,
            recentDishes,
            recentJobs,
          };
        }),
      listDishes: (status, cursor, limit) => dishes.listAdminDishes(status, cursor, limit),
      dishDetail: (dishId, locale) =>
        Effect.gen(function* () {
          const dish = yield* dishService.getDishForCuration(dishId, locale);

          const [notes, revisions] = yield* Effect.all(
            [curationService.listNotes(dish.id, 50), curationService.listRevisions(dish.id, 50)],
            { concurrency: 2 },
          );

          return { dish, notes, revisions };
        }),
      reviewQueue: (limit, cursor) => curationService.reviewQueue(limit, cursor),
      importJobs: (limit) => curation.recentImportJobs(limit),
      importJobDetail: (jobId, recordLimit) =>
        Effect.gen(function* () {
          if (!isDbIdString(jobId)) {
            return yield* new DishNotFound({ dishId: jobId });
          }

          const job = yield* curation.adminFindImportJob(BigInt(jobId));

          if (job === null) {
            return yield* new DishNotFound({ dishId: jobId });
          }

          const records = yield* curation.adminRecordsByJobId(BigInt(jobId), recordLimit);

          return { job, records };
        }),
      validateImport: (input) => importService.validateImport(input),
      applyImport: (input) => importService.applyImport(input),
      publishDish: (userId, dishId, status) =>
        adminService.updateDishStatus(`admin:${userId}`, dishId, status),
      publicationCheck: (dishId) =>
        isDbIdString(dishId)
          ? curationService.validatePublication(BigInt(dishId))
          : Effect.fail(new DishNotFound({ dishId })),
    });
  }),
);
