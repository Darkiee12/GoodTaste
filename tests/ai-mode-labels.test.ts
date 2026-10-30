import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AiExplanationCard } from "@/components/home/recommend/quiz-status";
import { messagesFor } from "@/shared/i18n";

const copyEn = messagesFor("en");
const copyVi = messagesFor("vi");

const UNAVAILABLE_FALLBACK = "AI ranking was unavailable; used deterministic order instead.";
const SURPRISE = "Surprise variety applied: showing a different slice of the eligible pool.";

describe("ai explanation card", () => {
  test("ai mode renders the cream card with sparkles, Muse note, and ranking-only explainer", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({ copy: copyEn, mode: "ai", warnings: [] }),
    );

    expect(html).toContain(copyEn.recAiRankedTitle);
    expect(html).toContain("<svg");
    expect(html).toContain("bg-cream");
    expect(html).toContain("Muse re-ranked these catalog matches");
    expect(html).toContain("stay as curated");
  });

  test("ai mode never presents catalog copy as AI-written and never invents scores", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({ copy: copyEn, mode: "ai", warnings: [] }),
    ).toLowerCase();

    expect(html).not.toContain("written by");
    expect(html).not.toContain("generated description");
    expect(html).not.toContain("score");
    expect(html).not.toContain("%");
  });

  test("ai mode explains ranking-only in Vietnamese", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({ copy: copyVi, mode: "ai", warnings: [] }),
    );

    expect(html).toContain(copyVi.recAiRankedTitle);
    expect(html).toContain("<svg");
    expect(html).toContain("giữ nguyên bản biên tập");
  });

  test("deterministic mode shows catalog wording with no Muse branding", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({ copy: copyEn, mode: "deterministic", warnings: [] }),
    );

    expect(html).toContain("Selected from our food catalog");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Muse");
  });

  test("degraded deterministic stays honest with no Muse branding", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({
        copy: copyEn,
        mode: "deterministic",
        warnings: [UNAVAILABLE_FALLBACK],
      }),
    );

    expect(html).toContain("not AI-ranked");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Ranked by Muse");
  });

  test("non-fallback warnings keep the plain catalog sentence", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({
        copy: copyEn,
        mode: "deterministic",
        warnings: [SURPRISE],
      }),
    );

    expect(html).toContain("Selected from our food catalog");
    expect(html).not.toContain("not AI-ranked");
  });

  test("empty mode renders reasons and the suggest line with no dish branding", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({
        copy: copyEn,
        mode: "empty",
        reasons: ["No dishes match those filters."],
        warnings: [],
      }),
    );

    expect(html).toContain(copyEn.recReasonsHeading);
    expect(html).toContain("No dishes match those filters.");
    expect(html).toContain(copyEn.recEmptySuggest);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Muse");
  });

  test("uncertain mode renders reasons without the empty suggest line", () => {
    const html = renderToStaticMarkup(
      AiExplanationCard({
        copy: copyEn,
        mode: "uncertain",
        reasons: ["Could not verify safety for those allergies."],
        warnings: [],
      }),
    );

    expect(html).toContain(copyEn.recReasonsHeading);
    expect(html).toContain("Could not verify safety for those allergies.");
    expect(html).not.toContain(copyEn.recEmptySuggest);
    expect(html).not.toContain("<svg");
  });

  test("mode stays the single branding source even with fallback warnings present", () => {
    const aiHtml = renderToStaticMarkup(
      AiExplanationCard({
        copy: copyEn,
        mode: "ai",
        warnings: [UNAVAILABLE_FALLBACK],
      }),
    );

    expect(aiHtml).toContain("<svg");
    expect(aiHtml).toContain(copyEn.recAiRankedTitle);
  });
});
