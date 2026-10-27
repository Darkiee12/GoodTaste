import { z } from "zod";
import type { ZodType } from "zod";

import { dbIdSchema } from "@/modules/food-discovery/food.schema";

const searchCursorSchema = z.object({
  tier: z.number(),
  id: dbIdSchema,
});

const browseCursorSchema = z.object({
  updated: z.string(),
  id: dbIdSchema,
});

const filterCursorSchema = z.object({
  id: dbIdSchema,
});

export interface SearchCursor {
  readonly tier: number;
  readonly id: string;
}

export interface BrowseCursor {
  readonly updated: string;
  readonly id: string;
}

export interface FilterCursor {
  readonly id: string;
}

const textFromCursor = (cursor: string): string | null => {
  if (cursor.length === 0 || cursor.length > 500) {
    return null;
  }

  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
};

const decodeCursorPayload = <Decoded>(
  cursor: string | undefined,
  schema: ZodType<Decoded>,
): Decoded | null => {
  if (cursor === undefined) {
    return null;
  }

  const text = textFromCursor(cursor);

  if (text === null) {
    return null;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = schema.safeParse(raw);

  return parsed.success ? parsed.data : null;
};

export const encodeCursor = (value: SearchCursor | BrowseCursor | FilterCursor): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export const decodeSearchCursor = (cursor: string | undefined): SearchCursor | null =>
  decodeCursorPayload(cursor, searchCursorSchema);

export const decodeBrowseCursor = (cursor: string | undefined): BrowseCursor | null =>
  decodeCursorPayload(cursor, browseCursorSchema);

export const decodeFilterCursor = (cursor: string | undefined): FilterCursor | null =>
  decodeCursorPayload(cursor, filterCursorSchema);
