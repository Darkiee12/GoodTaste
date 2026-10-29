import type { Locale } from "@/shared/i18n";

export interface ResolvedActor {
  readonly actor: string;
  readonly actorDisplayName: string | null;
  readonly importJobId: string | null;
  readonly appliedByDisplayName: string | null;
}

export interface ResolvedAuthor {
  readonly author: string;
  readonly authorDisplayName: string | null;
  readonly importJobId: string | null;
  readonly appliedByDisplayName: string | null;
}

export interface ActorSummary {
  readonly primary: string;
  readonly secondary: string | null;
  /** Raw stored value is audit evidence; show it only inside <details>. */
  readonly raw: string;
  readonly needsDetails: boolean;
}

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

const OPERATION_LABELS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> = new Map(
  [
    ["created", { en: "Created", vi: "Đã tạo" }],
    ["status_changed", { en: "Status changed", vi: "Đổi trạng thái" }],
    ["name_added", { en: "Name added", vi: "Thêm tên" }],
    ["description_updated", { en: "Description updated", vi: "Cập nhật mô tả" }],
    ["ingredient_linked", { en: "Ingredient added", vi: "Thêm nguyên liệu" }],
    ["place_linked", { en: "Region associated", vi: "Liên kết vùng" }],
    ["category_linked", { en: "Category linked", vi: "Liên kết danh mục" }],
    ["cuisine_linked", { en: "Cuisine linked", vi: "Liên kết ẩm thực" }],
    ["import_applied", { en: "Import applied", vi: "Đã áp dụng nhập" }],
    ["note_added", { en: "Note added", vi: "Thêm ghi chú" }],
  ],
);

const ROLE_LABELS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> = new Map([
  ["core", { en: "Core ingredient", vi: "Nguyên liệu chính" }],
  ["common", { en: "Common ingredient", vi: "Nguyên liệu phổ biến" }],
  ["optional", { en: "Optional", vi: "Tùy chọn" }],
  ["garnish", { en: "Garnish", vi: "Trang trí" }],
]);

const ASSOCIATION_LABELS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> =
  new Map([
    ["origin", { en: "Origin", vi: "Xuất xứ" }],
    ["associated", { en: "Associated with", vi: "Liên quan" }],
    ["popular", { en: "Popular in", vi: "Phổ biến tại" }],
  ]);

const NOTE_KIND_LABELS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> = new Map(
  [
    ["review", { en: "Review", vi: "Đánh giá" }],
    ["correction", { en: "Correction", vi: "Chỉnh sửa" }],
    ["question", { en: "Question", vi: "Câu hỏi" }],
  ],
);

const labelFrom = (
  table: ReadonlyMap<string, { readonly en: string; readonly vi: string }>,
  value: string,
  lang: Locale,
): string => {
  const entry = table.get(value);

  if (entry === undefined) {
    return value;
  }

  return pick(lang, entry.en, entry.vi);
};

export const operationLabel = (operation: string, lang: Locale): string => {
  const known = OPERATION_LABELS.get(operation);

  if (known !== undefined) {
    return pick(lang, known.en, known.vi);
  }

  return pick(lang, "Unknown activity", "Hoạt động không rõ");
};

export const isKnownOperation = (operation: string): boolean => OPERATION_LABELS.has(operation);

export const roleLabel = (role: string, lang: Locale): string => labelFrom(ROLE_LABELS, role, lang);

export const associationLabel = (association: string, lang: Locale): string =>
  labelFrom(ASSOCIATION_LABELS, association, lang);

export const noteKindLabel = (kind: string, lang: Locale): string =>
  labelFrom(NOTE_KIND_LABELS, kind, lang);

const IMPORT_JOB_PATTERN = /^import:[0-9]+$/;

export const actorSummary = (input: ResolvedActor, lang: Locale): ActorSummary => {
  if (input.actor === "system") {
    return {
      primary: pick(lang, "System", "Hệ thống"),
      secondary: null,
      raw: input.actor,
      needsDetails: false,
    };
  }

  if (IMPORT_JOB_PATTERN.test(input.actor)) {
    if (input.importJobId !== null) {
      const secondary =
        input.appliedByDisplayName === null
          ? null
          : pick(
              lang,
              `Applied by ${input.appliedByDisplayName}`,
              `Người áp dụng: ${input.appliedByDisplayName}`,
            );

      return {
        primary: pick(
          lang,
          `Imported via Job #${input.importJobId}`,
          `Đã nhập qua Job #${input.importJobId}`,
        ),
        secondary,
        raw: input.actor,
        needsDetails: false,
      };
    }

    return {
      primary: pick(
        lang,
        "Historical import · Actor unavailable",
        "Dữ liệu nhập cũ · Không rõ tác giả",
      ),
      secondary: null,
      raw: input.actor,
      needsDetails: true,
    };
  }

  if (input.actor.startsWith("member:") || input.actor.startsWith("admin:")) {
    if (input.actorDisplayName !== null) {
      return {
        primary: pick(lang, `By ${input.actorDisplayName}`, `Bởi ${input.actorDisplayName}`),
        secondary: null,
        raw: input.actor,
        needsDetails: false,
      };
    }

    return {
      primary: pick(lang, "Former member · Actor unavailable", "Thành viên cũ · Không rõ tác giả"),
      secondary: null,
      raw: input.actor,
      needsDetails: true,
    };
  }

  return {
    primary: pick(
      lang,
      "Historical import · Actor unavailable",
      "Dữ liệu nhập cũ · Không rõ tác giả",
    ),
    secondary: null,
    raw: input.actor,
    needsDetails: true,
  };
};

export const authorSummary = (input: ResolvedAuthor, lang: Locale): ActorSummary => {
  if (IMPORT_JOB_PATTERN.test(input.author)) {
    return actorSummary(
      {
        actor: input.author,
        actorDisplayName: input.authorDisplayName,
        importJobId: input.importJobId,
        appliedByDisplayName: input.appliedByDisplayName,
      },
      lang,
    );
  }

  if (input.author.startsWith("member:") || input.author.startsWith("admin:")) {
    if (input.authorDisplayName !== null) {
      return {
        primary: pick(lang, `By ${input.authorDisplayName}`, `Bởi ${input.authorDisplayName}`),
        secondary: null,
        raw: input.author,
        needsDetails: false,
      };
    }

    return {
      primary: pick(lang, "Former member · Actor unavailable", "Thành viên cũ · Không rõ tác giả"),
      secondary: null,
      raw: input.author,
      needsDetails: true,
    };
  }

  return { primary: input.author, secondary: null, raw: input.author, needsDetails: false };
};

export const isVerifiedHttpsUrl = (value: string | null): value is string => {
  if (value === null) {
    return false;
  }

  return value.startsWith("https://");
};
