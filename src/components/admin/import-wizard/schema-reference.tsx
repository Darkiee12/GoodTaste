import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CSV_COLUMNS, RECORD_FIELDS } from "@/components/admin/import-wizard/helpers";
import type { ReferenceFieldRow } from "@/components/admin/import-wizard/helpers";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  SOURCE_REGISTRY,
  importLicenseSchema,
} from "@/modules/food-discovery/admin.schema";
import type { Messages } from "@/shared/i18n";

/**
 * Schema discoverability for the Upload stage: a modal reference derived
 * from the REAL contracts, never a hand-maintained duplicate.
 *
 * Sources (verified, not guessed):
 * - `admin.schema.ts`: MAX_IMPORT_FILE_BYTES / MAX_IMPORT_RECORDS,
 *   SOURCE_REGISTRY ids + reuse rules, the license enum options,
 *   csvToRecords/jsonToRecords shapes, and the import-job status
 *   vocabulary (staged, validated, applying, applied, failed).
 * - `server/domain/schemas.ts` AuthoringDish (+ `server/domain/ids.ts`
 *   Slug, LanguageTag, IngredientRole, PlaceAssociation, NameKind): the
 *   RECORD_FIELDS table mirrors that Struct field by field.
 * - CSV columns mirror the documented `csvToRecords` contract
 *   (slug,status,parent_slug,name,language_tag,name_kind,description,
 *   ingredients,places,cuisines,categories,editorial_note); the strict
 *   server parser rejects anything else, so this table cannot silently
 *   go stale — an added column fails loudly in review, not here.
 *
 * No "Download JSON Schema" button: the installed Effect version does
 * ship `effect/JsonSchema`, but a trustworthy artifact needs build-time
 * codegen from the server-only ImportPayload plus a CI freshness check.
 * Shipping a checked-in snapshot without that pipeline would be exactly
 * the hand-maintained duplicate the spec forbids, so the template +
 * sample downloads plus this table stand in until that pipeline exists.
 */

function ReferenceTable({
  copy,
  rows,
}: {
  readonly copy: Messages;
  readonly rows: ReadonlyArray<ReferenceFieldRow>;
}): ReactNode {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border-soft">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border-soft bg-cream/60">
            <th scope="col" className="px-3 py-2 font-semibold">
              {copy.adminImportSchemaField}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {copy.adminImportSchemaRequirement}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {copy.adminImportSchemaType}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="border-b border-border-soft align-top last:border-0">
              <td className="px-3 py-2 font-mono text-[13px] font-semibold">{row.field}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {row.required ? copy.adminImportSchemaRequired : copy.adminImportSchemaOptional}
              </td>
              <td className="px-3 py-2 break-words">{row.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SchemaReference({ copy }: { readonly copy: Messages }): ReactNode {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) {
      return () => undefined;
    }

    previousFocus.current = document.activeElement;
    panelRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);

        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const panel = panelRef.current;

      if (panel === null) {
        return;
      }

      const items = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );

      const first = items[0];
      const last = items[items.length - 1];

      if (first === undefined || last === undefined) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);

      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center rounded-full border border-border-soft bg-white px-5 text-sm font-bold text-ink hover:bg-cream motion-safe:transition-colors"
      >
        {copy.adminImportSchemaButton}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <dialog
            ref={panelRef}
            open
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[85dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border-soft bg-white p-5 sm:p-6"
          >
            <h2 id={titleId} className="font-display text-2xl tracking-wide">
              {copy.adminImportSchemaTitle}
            </h2>
            <p className="mt-2 text-sm text-muted">{copy.adminImportSchemaIntro}</p>
            <p className="mt-2 text-sm font-semibold">
              Max {MAX_IMPORT_FILE_BYTES} bytes, max {MAX_IMPORT_RECORDS} records per import job.
            </p>

            <h3 className="mt-5 text-lg font-bold">{copy.adminImportSchemaJsonHeading}</h3>
            <p className="mt-1 text-sm text-muted">
              {'{ "records": [ … ] }'} or a bare <code>[ … ]</code> array. Empty arrays are
              rejected; extra envelope fields (no version field — there is no versioning strategy)
              are ignored by the parser but never required.
            </p>

            <h3 className="mt-5 text-lg font-bold">{copy.adminImportSchemaFieldsHeading}</h3>
            <ReferenceTable copy={copy} rows={RECORD_FIELDS} />

            <h3 className="mt-5 text-lg font-bold">{copy.adminImportSchemaCsvHeading}</h3>
            <p className="mt-1 text-sm text-muted">
              Header row plus one row per dish. Unknown or duplicated columns fail loudly; every
              data row must match the header width exactly.
            </p>
            <ReferenceTable
              copy={copy}
              rows={CSV_COLUMNS.map((column) => ({
                field: column.name,
                required: column.name === "name",
                type: column.detail,
              }))}
            />

            <h3 className="mt-5 text-lg font-bold">{copy.adminImportSchemaRulesHeading}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              <li>
                Sources: {SOURCE_REGISTRY.map((entry) => entry.id).join(", ")} —{" "}
                {SOURCE_REGISTRY.map((entry) => `${entry.id}: ${entry.reuseRule}`).join(" ")}
              </li>
              <li>Licenses: {importLicenseSchema.options.join(", ")}.</li>
              <li>
                Lifecycle: staged → validated → applying → applied (failed is a terminal state, not
                a step). {copy.adminImportSchemaLifecycle}
              </li>
            </ul>

            <p className="mt-5 flex flex-wrap justify-end">
              <button
                type="button"
                data-autofocus
                onClick={() => {
                  setOpen(false);
                }}
                className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white hover:bg-brand-blue-hover motion-safe:transition-colors"
              >
                {copy.adminImportSchemaClose}
              </button>
            </p>
          </dialog>
        </div>
      ) : null}
    </>
  );
}
