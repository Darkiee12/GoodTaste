import { Context, Effect, Layer } from "effect";

import {
  DishNotFound,
  InvalidDishData,
  type InvalidLocale,
} from "@/modules/food-discovery/server/domain/errors";
import { encodeDbId, isDbIdString } from "@/modules/food-discovery/server/domain/ids";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import { DishRelationsRepository } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import { DishRepository } from "@/modules/food-discovery/server/repository/dish-repository";
import type { Database } from "@/server/database/client";
import type {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
  TransactionConflict,
} from "@/server/database/errors";

export type CurationServiceError =
  | DishNotFound
  | InvalidDishData
  | InvalidLocale
  | DatabaseUnavailable
  | PersistenceError
  | PersistenceConflict
  | TransactionConflict;

export interface PublicationCheck {
  readonly publishable: boolean;
  readonly reasons: ReadonlyArray<string>;
}

export class CurationService extends Context.Service<
  CurationService,
  {
    readonly validatePublication: (
      dishId: bigint,
    ) => Effect.Effect<PublicationCheck, CurationServiceError, Database>;
    readonly recordRevision: (
      dishId: bigint,
      actor: string,
      operation: string,
      summary: string,
    ) => Effect.Effect<void, CurationServiceError, Database>;
    readonly addNote: (
      dishId: string,
      author: string,
      noteKind: string,
      note: string,
    ) => Effect.Effect<{ readonly noteId: string }, CurationServiceError, Database>;
    readonly listNotes: (
      dishId: string,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly author: string;
        readonly noteKind: string;
        readonly note: string;
        readonly createdAt: string;
      }>,
      CurationServiceError,
      Database
    >;
    readonly listRevisions: (
      dishId: string,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly actor: string;
        readonly operation: string;
        readonly summary: string;
        readonly createdAt: string;
      }>,
      CurationServiceError,
      Database
    >;
    readonly reviewQueue: (
      limit: number,
      cursor: bigint,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: string; readonly slug: string; readonly status: string }>,
      CurationServiceError,
      Database
    >;
  }
>()("feastjourney/food-discovery/CurationService") {}

const NOTE_KINDS: ReadonlySet<string> = new Set(["review", "correction", "question"]);

const REVISION_OPERATIONS: ReadonlySet<string> = new Set([
  "created",
  "status_changed",
  "name_added",
  "description_updated",
  "ingredient_linked",
  "place_linked",
  "category_linked",
  "cuisine_linked",
  "import_applied",
  "note_added",
]);

export const CurationServiceLive = Layer.effect(
  CurationService,
  Effect.gen(function* () {
    const dishes = yield* DishRepository;
    const relations = yield* DishRelationsRepository;
    const curation = yield* CurationRepository;

    const requireDish = (dishId: string) =>
      Effect.gen(function* () {
        if (!isDbIdString(dishId)) {
          return yield* new DishNotFound({ dishId });
        }

        const record = yield* dishes.findById(BigInt(dishId));

        if (record === null) {
          return yield* new DishNotFound({ dishId });
        }

        return record;
      });

    const validatePublication = (dishId: bigint) =>
      Effect.gen(function* () {
        const reasons: Array<string> = [];
        const record = yield* dishes.findById(dishId);

        if (record === null) {
          return yield* new DishNotFound({ dishId: dishId.toString() });
        }

        const [names, descriptions, categories] = yield* Effect.all(
          [
            relations.namesByDishIds([dishId]),
            relations.descriptionsByDishIds([dishId]),
            relations.categoriesByDishIds([dishId]),
          ],
          { concurrency: 3 },
        );

        const englishPreferred = names.some(
          (entry) => entry.language_tag === "en" && entry.is_preferred,
        );

        if (!englishPreferred) {
          reasons.push("published dishes require a preferred English name");
        }

        if (record.slug.length === 0) {
          reasons.push("published dishes require a canonical slug");
        }

        const hasDescription = descriptions.some(
          (entry) => entry.description.trim().length > 0 || (entry.summary ?? "").trim().length > 0,
        );

        if (!hasDescription) {
          reasons.push("published dishes require a description or summary");
        }

        if (categories.length === 0) {
          reasons.push("published dishes require at least one category");
        }

        return { publishable: reasons.length === 0, reasons };
      });

    const recordRevision = (dishId: bigint, actor: string, operation: string, summary: string) =>
      Effect.gen(function* () {
        if (!REVISION_OPERATIONS.has(operation)) {
          return yield* new InvalidDishData({ reason: `unknown revision operation: ${operation}` });
        }

        const trimmedActor = actor.trim().slice(0, 200);

        if (trimmedActor.length === 0) {
          return yield* new InvalidDishData({ reason: "revision actor is required" });
        }

        const trimmedSummary = summary.trim().slice(0, 1000);

        if (trimmedSummary.length === 0) {
          return yield* new InvalidDishData({ reason: "revision summary is required" });
        }

        yield* curation.insertRevision({
          dishId,
          actor: trimmedActor,
          operation,
          summary: trimmedSummary,
        });

        return yield* Effect.void;
      });

    const addNote = (dishId: string, author: string, noteKind: string, note: string) =>
      Effect.gen(function* () {
        const record = yield* requireDish(dishId);

        if (!NOTE_KINDS.has(noteKind)) {
          return yield* new InvalidDishData({ reason: "unknown note kind" });
        }

        const trimmedAuthor = author.trim().slice(0, 200);

        if (trimmedAuthor.length === 0) {
          return yield* new InvalidDishData({ reason: "note author is required" });
        }

        const trimmed = note.trim();

        if (trimmed.length === 0 || trimmed.length > 5000) {
          return yield* new InvalidDishData({ reason: "note must be 1-5000 characters" });
        }

        const created = yield* curation.insertNote({
          dishId: record.id,
          author: trimmedAuthor,
          noteKind,
          note: trimmed,
        });

        return { noteId: encodeDbId(created.id) };
      });

    const listNotes = (dishId: string, limit: number) =>
      Effect.gen(function* () {
        const record = yield* requireDish(dishId);
        const rows = yield* curation.notesByDishId(record.id, limit);

        return rows.map((entry) => ({
          id: encodeDbId(entry.id),
          author: entry.author,
          noteKind: entry.note_kind,
          note: entry.note,
          createdAt: entry.created_at,
        }));
      });

    const listRevisions = (dishId: string, limit: number) =>
      Effect.gen(function* () {
        const record = yield* requireDish(dishId);
        const rows = yield* curation.revisionsByDishId(record.id, limit);

        return rows.map((entry) => ({
          id: encodeDbId(entry.id),
          actor: entry.actor,
          operation: entry.operation,
          summary: entry.summary,
          createdAt: entry.created_at,
        }));
      });

    const reviewQueue = (limit: number, cursor: bigint) =>
      Effect.gen(function* () {
        const rows = yield* dishes.listByStatus("review", cursor, limit);

        return rows.map((record) => ({
          id: encodeDbId(record.id),
          slug: record.slug,
          status: record.status,
        }));
      });

    return CurationService.of({
      validatePublication,
      recordRevision,
      addNote,
      listNotes,
      listRevisions,
      reviewQueue,
    });
  }),
);
