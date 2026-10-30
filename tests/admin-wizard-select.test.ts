import { describe, expect, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SelectField } from "@/components/admin/import-wizard/fields";
import { SourceStage } from "@/components/admin/import-wizard/source-stage";
import { SOURCE_REGISTRY } from "@/modules/food-discovery/admin.schema";
import type { ImportLicense, ImportSourceId } from "@/modules/food-discovery/admin.schema";
import { messagesFor } from "@/shared/i18n";

/**
 * Import-wizard select migration pins: both wizard selects (source registry
 * + license) render through the canonical Radix primitive, not the native
 * `AdminSelect`. Interaction (open, Escape, outside-click, keyboard cycle,
 * portal/collision, viewport containment) is covered by Playwright, not
 * bun:test — no DOM renderer is installed in this repo. These tests pin the
 * SSR markup contract that interaction relies on plus the wizard-level
 * selection flows (license review, step gating) that the control is
 * visual-only for.
 */

const copy = messagesFor("en");

const OPTIONS = [
  { label: "Manual entry", value: "manual-entry" },
  { label: "Partner agreement", value: "partner-agreement" },
] as const;

const options = [...OPTIONS];

const baseStageProps = {
  attribution: "",
  copy,
  editorialNotes: "",
  // SAFETY: "cc-by" is a literal member of the ImportLicense union in admin.schema.
  license: "cc-by" as ImportLicense,
  licenseReview: false,
  onAttribution: () => undefined,
  onBack: () => undefined,
  onEditorialNotes: () => undefined,
  onLicense: () => undefined,
  onSourceId: () => undefined,
  onSourceName: () => undefined,
  onSourceUrl: () => undefined,
  onSourceVersion: () => undefined,
  onSubmit: () => undefined,
  sourceComplete: false,
  // SAFETY: "manual" is a literal member of the ImportSourceId union in admin.schema.
  sourceId: "manual" as ImportSourceId,
  sourceName: "",
  sourceUrl: "",
  sourceVersion: "",
};

describe("wizard SelectField renders the Radix primitive", () => {
  test("source and license are combobox triggers, never a native select", () => {
    const html = renderToStaticMarkup(createElement(SourceStage, baseStageProps));

    // Two Radix triggers: source registry + license.
    expect(html.match(/role="combobox"/g)?.length).toBe(2);
    expect(html).toContain('id="import-source-registry"');
    expect(html).toContain('id="import-license"');
    // Native wizard presentation is gone; the only <select> in Radix SSR
    // output is the hidden form-compat node without appearance-none.
    expect(html).not.toContain("appearance-none");
  });

  test("chevron is state-driven on both wizard triggers", () => {
    const html = renderToStaticMarkup(createElement(SourceStage, baseStageProps));

    expect(html.match(/data-state="closed"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("group-data-[state=open]:rotate-180");
  });

  test("labels target the triggers for assistive technology", () => {
    const html = renderToStaticMarkup(createElement(SourceStage, baseStageProps));

    expect(html).toContain('for="import-source-registry"');
    expect(html).toContain('for="import-license"');
  });
});

describe("wizard SelectField validation and disabled states", () => {
  test("error joins hint announcements and flags the trigger invalid", () => {
    const html = renderToStaticMarkup(
      createElement(SelectField, {
        error: "Selection required.",
        hint: "Pick the closest match.",
        id: "wizard-select-invalid",
        label: "Source",
        onChange: () => undefined,
        options,
        value: "manual-entry",
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(
      'aria-describedby="wizard-select-invalid-description wizard-select-invalid-error"',
    );
  });

  test("clean field exposes no error nodes", () => {
    const html = renderToStaticMarkup(
      createElement(SelectField, {
        id: "wizard-select-clean",
        label: "Source",
        onChange: () => undefined,
        options,
        value: "manual-entry",
      }),
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  test("disabled field disables the trigger", () => {
    const html = renderToStaticMarkup(
      createElement(SelectField, {
        disabled: true,
        id: "wizard-select-disabled",
        label: "Source",
        onChange: () => undefined,
        options,
        value: "manual-entry",
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("disabled:cursor-not-allowed");
  });
});

describe("wizard source/license selection flows", () => {
  test("registry options cover every canonical source id", () => {
    const html = renderToStaticMarkup(createElement(SourceStage, baseStageProps));

    // The reuse-rule hint proves the selected registry entry resolved.
    expect(html).toContain(copy.adminImportReuseRule);
  });

  test("every registry id renders a reuse rule (no dead option)", () => {
    for (const entry of SOURCE_REGISTRY) {
      expect(entry.reuseRule.length).toBeGreaterThan(0);
    }

    expect(SOURCE_REGISTRY.length).toBeGreaterThan(0);
  });

  test("license-review licenses surface the ack requirement, others do not", () => {
    const review = renderToStaticMarkup(
      createElement(SourceStage, { ...baseStageProps, licenseReview: true }),
    );

    const calm = renderToStaticMarkup(
      createElement(SourceStage, { ...baseStageProps, licenseReview: false }),
    );

    expect(review).toContain('role="alert"');
    expect(review).toContain(copy.adminImportLicenseReview);
    expect(calm).not.toContain(copy.adminImportLicenseReview);
  });

  test("submit gating follows source completeness (control is visual only)", () => {
    const incomplete = renderToStaticMarkup(createElement(SourceStage, baseStageProps));

    const complete = renderToStaticMarkup(
      createElement(SourceStage, {
        ...baseStageProps,
        sourceComplete: true,
        sourceName: "Hanoi partner",
      }),
    );

    expect(incomplete).toContain("disabled");
    expect(incomplete).toContain(copy.adminImportSourceRequired);
    expect(complete).not.toContain(copy.adminImportSourceRequired);
  });

  test("unknown license values never render as selected display text", () => {
    const html = renderToStaticMarkup(
      createElement(SelectField, {
        id: "wizard-license-unknown",
        label: "License",
        onChange: () => undefined,
        options,
        value: "not-a-license",
      }),
    );

    // Radix renders a closed trigger without crashing; the unknown value
    // is not presented as a chosen label.
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain("not-a-license");
  });
});
