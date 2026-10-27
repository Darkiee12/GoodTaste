/**
 * Deterministic search-key normalization shared by seed data, admin writes,
 * ingestion, and query input preparation. Latin diacritics are folded
 * (phở → pho); non-Latin scripts pass through unchanged, which means CJK/Thai/
 * Arabic matching relies on exact/prefix search keys rather than
 * transliteration. That limitation is documented in the API reference and
 * improved incrementally, never silently claimed as solved.
 */
export const normalizeSearchKey = (value: string): string => {
  const folded = value.replace(/đ/g, "d").replace(/Đ/g, "d");

  return folded
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .normalize("NFC")
    .replace(/[ʼ'’`]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
};

export const toPrefixKey = (key: string): string => `${key}%`;

export const toContainsKey = (key: string): string => `%${key}%`;

export interface LocalizedName {
  readonly languageTag: string;
  readonly name: string;
  readonly nameKind?: string | undefined;
  readonly isPreferred: boolean;
}

export const asLocalizedName = (row: {
  readonly language_tag: string;
  readonly name: string;
  readonly is_preferred: boolean;
}): LocalizedName => ({
  languageTag: row.language_tag,
  name: row.name,
  isPreferred: row.is_preferred,
});

/**
 * Deterministic locale fallback: exact-locale preferred name, then any exact-
 * locale name, then English preferred, then any English name, then the first
 * preferred name in any language, then the first name. English is the default
 * display fallback; transliterations are never promoted above native names of
 * the requested locale.
 */
export const pickDisplayName = (
  names: ReadonlyArray<LocalizedName>,
  locale: string,
): LocalizedName | undefined => {
  if (names.length === 0) {
    return undefined;
  }

  const base = locale.split("-")[0]?.toLowerCase() ?? locale;

  const exactLocale = names.filter(
    (entry) => entry.languageTag.toLowerCase() === locale.toLowerCase(),
  );

  const baseLocale =
    base === locale.toLowerCase()
      ? []
      : names.filter((entry) => entry.languageTag.toLowerCase() === base);

  const english = names.filter((entry) => entry.languageTag === "en");

  const preferred = (entries: ReadonlyArray<LocalizedName>): LocalizedName | undefined =>
    entries.find((entry) => entry.isPreferred) ?? entries[0];

  return (
    preferred(exactLocale) ??
    preferred(baseLocale) ??
    preferred(english) ??
    names.find((entry) => entry.isPreferred) ??
    names[0]
  );
};

const MAX_QUERY_LENGTH = 200;

export const isSearchableQuery = (query: string): boolean => {
  const trimmed = query.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_QUERY_LENGTH;
};
