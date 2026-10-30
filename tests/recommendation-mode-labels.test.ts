import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { RankingNote } from "@/components/home/recommend/quiz-status";
import { messagesFor } from "@/shared/i18n";

const copyEn = messagesFor("en");
const copyVi = messagesFor("vi");

// Server-English warning sentences (recommendation-service.ts hardcodes them
// regardless of UI locale); the mode label only matches the AI-failure
// markers, it never re-derives the ranking mode from them.
const UNAVAILABLE_FALLBACK = "AI ranking was unavailable; used deterministic order instead.";
const RATE_LIMIT_FALLBACK = "AI ranking was rate-limited; used deterministic order instead.";
const NOT_CONFIGURED = "Deterministic mode: AI ranking is not configured.";
const SURPRISE = "Surprise variety applied: showing a different slice of the eligible pool.";

describe("recommendation mode labels", () => {
  test("ai mode shows the sparkles icon, the AI note, and a ranking-only explainer", () => {
    const html = renderToStaticMarkup(RankingNote({ copy: copyEn, mode: "ai", warnings: [] }));

    expect(html).toContain(copyEn.recAiRankedTitle);
    expect(html).toContain("<svg");
    expect(html).toContain("Muse re-ranked these catalog matches");
    expect(html).toContain("stay as curated");
    expect(html.toLowerCase()).not.toContain("written by ai");
  });

  test("ai mode explains ranking-only in Vietnamese", () => {
    const html = renderToStaticMarkup(RankingNote({ copy: copyVi, mode: "ai", warnings: [] }));

    expect(html).toContain(copyVi.recAiRankedTitle);
    expect(html).toContain("<svg");
    expect(html).toContain("giữ nguyên bản biên tập");
  });

  test("deterministic mode shows catalog wording with no icon", () => {
    const html = renderToStaticMarkup(
      RankingNote({ copy: copyEn, mode: "deterministic", warnings: [] }),
    );

    expect(html).toContain("Selected from our food catalog");
    expect(html).not.toContain("<svg");
    expect(html.toLowerCase()).toContain("without ai ranking");
  });

  test("deterministic mode states catalog wording in Vietnamese with no icon", () => {
    const html = renderToStaticMarkup(
      RankingNote({ copy: copyVi, mode: "deterministic", warnings: [] }),
    );

    expect(html).toContain("không qua xếp hạng AI");
    expect(html).not.toContain("<svg");
  });

  test("deterministic fallback warnings render the honest non-AI explanation", () => {
    for (const warning of [UNAVAILABLE_FALLBACK, RATE_LIMIT_FALLBACK]) {
      const html = renderToStaticMarkup(
        RankingNote({ copy: copyEn, mode: "deterministic", warnings: [warning] }),
      );

      expect(html).toContain("not AI-ranked");
      expect(html).not.toContain("<svg");
    }

    const htmlVi = renderToStaticMarkup(
      RankingNote({
        copy: copyVi,
        mode: "deterministic",
        warnings: [UNAVAILABLE_FALLBACK],
      }),
    );

    expect(htmlVi).toContain("không phải do AI xếp hạng");
    expect(htmlVi).not.toContain("<svg");
  });

  test("non-fallback warnings keep the plain catalog sentence", () => {
    for (const warning of [NOT_CONFIGURED, SURPRISE, 'Ignored unknown dislike "durian".']) {
      const html = renderToStaticMarkup(
        RankingNote({ copy: copyEn, mode: "deterministic", warnings: [warning] }),
      );

      expect(html).toContain("Selected from our food catalog");
      expect(html).not.toContain("not AI-ranked");
    }
  });

  test("mode labels never promise dietary safety", () => {
    const variants = [
      RankingNote({ copy: copyEn, mode: "ai", warnings: [] }),
      RankingNote({ copy: copyEn, mode: "deterministic", warnings: [] }),
      RankingNote({
        copy: copyEn,
        mode: "deterministic",
        warnings: [UNAVAILABLE_FALLBACK],
      }),
    ];

    for (const node of variants) {
      const html = renderToStaticMarkup(node).toLowerCase();

      expect(html).not.toContain("guarantee");
      expect(html).not.toContain("allergy");
    }
  });
});
