import { describe, expect, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminSelectField } from "@/components/admin/select";
import { messagesFor } from "@/shared/i18n";

/**
 * Imports-toolbar status filter pins: the toolbar renders the canonical
 * Radix `AdminSelectField` (id `imports-status-filter`), never the native
 * `appearance-none` AdminSelect from `@/components/admin/ui`.
 *
 * Interaction (open, Escape, outside-click, keyboard cycle, portal/
 * collision, viewport containment) is covered by Playwright, not bun:test —
 * no DOM renderer is installed in this repo. These tests pin the SSR markup
 * contract that interaction relies on plus the option-label mapping the
 * toolbar builds from STATUS_FILTERS (which lives unexported in the route
 * module, so the mapping rule is mirrored here verbatim).
 */

const STATUS_FILTERS = ["all", "staged", "validated", "applying", "applied", "failed"] as const;

const toolbarOptions = (lang: "en" | "vi"): ReadonlyArray<{ label: string; value: string }> => {
  const copy = messagesFor(lang);

  return STATUS_FILTERS.map((value) => ({
    label: value === "all" ? copy.adminImportsAllStatuses : value,
    value,
  }));
};

const toolbarField = (props: {
  lang?: "en" | "vi";
  value?: string;
  disabled?: boolean;
  error?: string | null;
}) => {
  const lang = props.lang ?? "en";
  const copy = messagesFor(lang);

  return createElement(AdminSelectField, {
    id: "imports-status-filter",
    label: copy.adminImportsFilterStatus,
    value: props.value,
    onValueChange: () => undefined,
    options: [...toolbarOptions(lang)],
    disabled: props.disabled,
    error: props.error,
  });
};

describe("imports toolbar status filter renders the Radix primitive", () => {
  test("toolbar field is a combobox trigger, never a native select", () => {
    const html = renderToStaticMarkup(toolbarField({ value: "all" }));

    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="imports-status-filter"');
    expect(html).toContain('for="imports-status-filter"');
    // Native toolbar presentation is gone; the only <select> in Radix SSR
    // output is the hidden form-compat node without appearance-none.
    expect(html).not.toContain("appearance-none");
  });

  test("chevron is state-driven on the toolbar trigger", () => {
    const html = renderToStaticMarkup(toolbarField({ value: "all" }));

    expect(html).toContain('data-state="closed"');
    expect(html).toContain("group-data-[state=open]:rotate-180");
  });

  test("toolbar label matches the i18n filter key in en and vi", () => {
    const en = renderToStaticMarkup(toolbarField({ lang: "en", value: "all" }));
    const vi = renderToStaticMarkup(toolbarField({ lang: "vi", value: "all" }));

    expect(en).toContain(messagesFor("en").adminImportsFilterStatus);
    expect(vi).toContain(messagesFor("vi").adminImportsFilterStatus);
    expect(messagesFor("vi").adminImportsFilterStatus).not.toBe(
      messagesFor("en").adminImportsFilterStatus,
    );
  });
});

describe("imports toolbar status filter options", () => {
  test("options cover every lifecycle status plus the all entry", () => {
    for (const lang of ["en", "vi"] as const) {
      const options = toolbarOptions(lang);

      expect(options.map((option) => option.value)).toEqual([...STATUS_FILTERS]);
      expect(options).toHaveLength(6);
    }
  });

  test("only the all entry is relabeled, statuses render raw", () => {
    for (const lang of ["en", "vi"] as const) {
      const copy = messagesFor(lang);
      const options = toolbarOptions(lang);

      for (const option of options) {
        if (option.value === "all") {
          expect(option.label).toBe(copy.adminImportsAllStatuses);
        } else {
          expect(option.label).toBe(option.value);
        }
      }
    }
  });

  test("unknown values never render as selected display text", () => {
    const html = renderToStaticMarkup(toolbarField({ value: "not-a-status" }));

    // Radix renders a closed trigger without crashing; the unknown value
    // is not presented as a chosen label.
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain("not-a-status");
  });
});

describe("imports toolbar status filter a11y states", () => {
  test("error flags the trigger invalid and announces via alert", () => {
    const html = renderToStaticMarkup(toolbarField({ value: "all", error: "Selection required." }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="imports-status-filter-error"');
  });

  test("clean field exposes no error nodes", () => {
    const html = renderToStaticMarkup(toolbarField({ value: "failed" }));

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain("aria-describedby");
  });

  test("disabled field disables the trigger", () => {
    const html = renderToStaticMarkup(toolbarField({ value: "all", disabled: true }));

    expect(html).toContain("disabled");
    expect(html).toContain("disabled:cursor-not-allowed");
  });
});
