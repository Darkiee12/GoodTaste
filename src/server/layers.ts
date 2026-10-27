import { Layer } from "effect";
import type * as PersistenceRateLimiter from "effect/persistence/RateLimiter";

import { CatalogServicesLive, RepositoriesLive } from "@/modules/food-discovery/server/index";
import type { AdminService } from "@/modules/food-discovery/server/operations/admin-service";
import { CatalogImportServiceLive } from "@/modules/food-discovery/server/operations/catalog-import-service";
import type { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import type { CatalogService } from "@/modules/food-discovery/server/operations/catalog-service";
import { CurationServiceLive } from "@/modules/food-discovery/server/operations/curation-service";
import type { CurationService } from "@/modules/food-discovery/server/operations/curation-service";
import type { DishService } from "@/modules/food-discovery/server/operations/dish-service";
import type { DishRelationsRepository } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import type { DishRepository } from "@/modules/food-discovery/server/repository/dish-repository";
import type { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import type { PlaceRepository } from "@/modules/food-discovery/server/repository/place-repository";
import type {
  SourceRepository,
  TaxonomyRepository,
} from "@/modules/food-discovery/server/repository/taxonomy-repository";
import { DatabaseLive } from "@/server/database/client";
import type { Database } from "@/server/database/client";
import { RateLimiterLive, RateLimitPolicyLive } from "@/server/http/rate-limit";
import type { RateLimitPolicy } from "@/server/http/rate-limit";

const CurationLive = Layer.provide(CurationServiceLive, RepositoriesLive);

const DomainLive = Layer.provide(
  Layer.mergeAll(CatalogServicesLive, CatalogImportServiceLive),
  Layer.mergeAll(RepositoriesLive, CurationLive),
);

export const AppLive = Layer.mergeAll(
  DatabaseLive,
  RateLimiterLive,
  RateLimitPolicyLive,
  RepositoriesLive,
  CurationLive,
  DomainLive,
);

export type AppServices =
  | Database
  | PersistenceRateLimiter.RateLimiter
  | RateLimitPolicy
  | DishRepository
  | DishRelationsRepository
  | IngredientRepository
  | PlaceRepository
  | TaxonomyRepository
  | SourceRepository
  | DishService
  | CatalogService
  | AdminService
  | CatalogImportService
  | CurationService;
