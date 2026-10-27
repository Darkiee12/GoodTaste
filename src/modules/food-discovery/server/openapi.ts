const dishSummarySchema = {
  type: "object",
  required: ["id", "slug", "updatedAt", "lastUpdate"],
  properties: {
    id: { type: "string", description: "Stable dish identifier (decimal string)." },
    slug: { type: "string", description: "Application-owned canonical slug." },
    name: { type: ["string", "null"], description: "Display name in the requested locale." },
    english_name: { type: ["string", "null"] },
    region_names: { type: "array", items: { type: "string" } },
    category_slugs: { type: "array", items: { type: "string" } },
    updated_at: { type: "string", format: "date-time" },
    last_update: {
      type: "integer",
      description: "Unix seconds; database BIGINT is never serialized raw.",
    },
  },
} as const;

const dishProfileSchema = {
  type: "object",
  required: ["id", "slug", "status", "lastUpdate"],
  properties: {
    id: { type: "string" },
    slug: { type: "string" },
    name: { type: ["string", "null"] },
    english_name: { type: ["string", "null"] },
    native_names: {
      type: "array",
      items: {
        type: "object",
        required: ["languageTag", "name"],
        properties: { languageTag: { type: "string" }, name: { type: "string" } },
      },
    },
    description: { type: ["string", "null"] },
    description_language: { type: ["string", "null"] },
    status: { type: "string", enum: ["draft", "review", "published", "archived"] },
    parent: {
      type: ["object", "null"],
      properties: { id: { type: "string" }, slug: { type: "string" } },
    },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: ["string", "null"] },
          role: { type: "string", enum: ["core", "common", "optional", "garnish"] },
        },
      },
    },
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: ["string", "null"] },
          association: { type: "string", enum: ["origin", "associated", "popular"] },
          is_disputed: { type: "boolean" },
          kind: { type: "string" },
          iso3166: { type: ["string", "null"] },
          display_latitude: { type: ["number", "null"] },
          display_longitude: { type: ["number", "null"] },
        },
      },
    },
    cuisines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          name: { type: ["string", "null"] },
        },
      },
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          slug: { type: "string" },
          name: { type: ["string", "null"] },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          record_id: { type: "string" },
          provider: { type: "string" },
          external_id: { type: "string" },
          canonical_url: { type: ["string", "null"] },
          license: { type: ["string", "null"] },
          attribution: { type: ["string", "null"] },
        },
      },
    },
    last_update: { type: "integer" },
  },
} as const;

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "request_id"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        request_id: { type: "string" },
      },
    },
  },
} as const;

const searchParameters = [
  { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
  { name: "locale", in: "query", schema: { type: "string", default: "en" } },
  {
    name: "ingredient",
    in: "query",
    schema: { type: "string" },
    description: "Repeatable canonical ingredient id.",
  },
  {
    name: "ingredient_mode",
    in: "query",
    schema: { type: "string", enum: ["any", "all"], default: "any" },
  },
  {
    name: "category",
    in: "query",
    schema: { type: "string" },
    description: "Repeatable category slug.",
  },
  {
    name: "category_mode",
    in: "query",
    schema: { type: "string", enum: ["any", "all"], default: "any" },
  },
  { name: "cuisine", in: "query", schema: { type: "string" } },
  {
    name: "country",
    in: "query",
    schema: { type: "string" },
    description: "ISO 3166 country code; descendants included.",
  },
  {
    name: "region",
    in: "query",
    schema: { type: "string" },
    description: "Region place id; descendants included.",
  },
  {
    name: "place",
    in: "query",
    schema: { type: "string" },
    description: "Place id; descendants included.",
  },
  {
    name: "association",
    in: "query",
    schema: { type: "string", enum: ["origin", "associated", "popular"] },
  },
  {
    name: "sort",
    in: "query",
    schema: { type: "string", enum: ["relevance", "recent"], default: "relevance" },
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque keyset cursor." },
] as const;

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FeastJourney Catalog API",
    version: "1.0.0",
    description:
      "First-party multilingual dish catalog. Search is deterministic and keyset-paginated; " +
      "origin claims are provenance-backed and popularity never implies origin.",
  },
  paths: {
    "/api/v1/dishes": {
      get: {
        summary: "Search and paginate dishes",
        parameters: searchParameters,
        responses: {
          200: {
            description: "Dish summaries with a keyset cursor.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "next_cursor"],
                  properties: {
                    items: { type: "array", items: dishSummarySchema },
                    next_cursor: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid request.",
            content: { "application/json": { schema: errorSchema } },
          },
          429: {
            description: "Rate limited.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/v1/dishes/{id}": {
      get: {
        summary: "Full catalog dish profile (id or slug)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Dish profile.",
            content: { "application/json": { schema: dishProfileSchema } },
          },
          404: {
            description: "Not found.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/v1/dishes/{id}/related": {
      get: {
        summary: "Related dishes by shared categories, cuisines, places, and ingredients",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Related dish summaries." } },
      },
    },
    "/api/v1/ingredients": {
      get: {
        summary: "Search ingredients in supported languages",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "locale", in: "query", schema: { type: "string", default: "en" } },
        ],
        responses: { 200: { description: "Ingredient summaries." } },
      },
    },
    "/api/v1/ingredients/{id}": {
      get: {
        summary: "Ingredient detail with localized names",
        responses: { 200: { description: "Ingredient detail." } },
      },
    },
    "/api/v1/places": {
      get: {
        summary: "Countries and regions, optionally as a hierarchy",
        responses: { 200: { description: "Places plus parent edges." } },
      },
    },
    "/api/v1/places/{id}": {
      get: { summary: "Place detail", responses: { 200: { description: "Place detail." } } },
    },
    "/api/v1/places/{id}/dishes": {
      get: {
        summary: "Dishes for a place and its descendants",
        responses: { 200: { description: "Dish summaries with cursor." } },
      },
    },
    "/api/v1/categories": {
      get: {
        summary: "Grouped category definitions",
        responses: { 200: { description: "Categories." } },
      },
    },
    "/api/v1/cuisines": {
      get: { summary: "Cuisine classifications", responses: { 200: { description: "Cuisines." } } },
    },
    "/api/v1/admin/dishes": {
      post: {
        summary: "Create a dish (admin)",
        responses: { 201: { description: "Created dish id and slug." } },
      },
    },
    "/api/v1/admin/dishes/{id}": {
      put: {
        summary: "Update slug, parent, or status (admin)",
        responses: { 200: { description: "Updated dish id and slug." } },
      },
    },
    "/api/v1/admin/dishes/{id}/names": {
      post: {
        summary: "Add a dish name (admin)",
        responses: { 201: { description: "Added name." } },
      },
    },
    "/api/v1/admin/dishes/{id}/description": {
      put: {
        summary: "Upsert a dish description (admin)",
        responses: { 200: { description: "Updated flag." } },
      },
    },
    "/api/v1/admin/dishes/{id}/ingredients": {
      post: {
        summary: "Link an ingredient (admin)",
        responses: { 200: { description: "Linked flag." } },
      },
    },
    "/api/v1/admin/dishes/{id}/places": {
      post: {
        summary: "Link a place (admin)",
        responses: { 200: { description: "Linked flag." } },
      },
    },
    "/api/v1/admin/dishes/{id}/categories": {
      post: {
        summary: "Link a category (admin)",
        responses: { 200: { description: "Linked flag." } },
      },
    },
    "/api/v1/admin/dishes/{id}/cuisines": {
      post: {
        summary: "Link a cuisine (admin)",
        responses: { 200: { description: "Linked flag." } },
      },
    },
    "/api/v1/admin/dishes/{id}/notes": {
      post: {
        summary: "Add a curation note (admin)",
        responses: { 201: { description: "Created note id." } },
      },
      get: {
        summary: "List curation notes (admin)",
        responses: { 200: { description: "Notes." } },
      },
    },
    "/api/v1/admin/dishes/{id}/revisions": {
      get: {
        summary: "Inspect revision history (admin)",
        responses: { 200: { description: "Revisions." } },
      },
    },
    "/api/v1/admin/review-queue": {
      get: {
        summary: "Dishes awaiting review (admin)",
        responses: { 200: { description: "Review items." } },
      },
    },
    "/api/v1/admin/imports/validate": {
      post: {
        summary: "Validate and stage a bulk import without applying (admin)",
        responses: { 202: { description: "Validation report with staged job id." } },
      },
    },
    "/api/v1/admin/imports/apply": {
      post: {
        summary: "Apply a validated import job transactionally (admin)",
        responses: { 200: { description: "Apply report." } },
      },
    },
    "/health/live": { get: { summary: "Liveness", responses: { 200: { description: "Live." } } } },
    "/health/ready": {
      get: {
        summary: "Readiness with database check",
        responses: { 200: { description: "Ready." } },
      },
    },
  },
} as const;
