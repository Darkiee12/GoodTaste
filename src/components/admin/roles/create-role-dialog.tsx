import { useId, useState, type ReactNode } from "react";

import { AdminDialog, AdminSecondaryButton } from "@/components/admin/ui";

export interface CreateRoleDialogStrings {
  readonly title: string;
  readonly description: string;
  readonly slug: string;
  readonly slugHint: string;
  readonly name: string;
  readonly nameHint: string;
  readonly close: string;
  readonly create: string;
  readonly creating: string;
  readonly createFailed: string;
  readonly slugRequired: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const fieldClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm text-ink";

/**
 * Dedicated create state: a modal dialog, never permanent space above the
 * role list. Validates slug shape locally; server conflicts surface through
 * the mutation error rendered below.
 */
export function CreateRoleDialog({
  open,
  pending,
  failed,
  strings,
  onClose,
  onCreate,
}: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly strings: CreateRoleDialogStrings;
  readonly onClose: () => void;
  readonly onCreate: (input: { readonly slug: string; readonly name: string }) => void;
}): ReactNode {
  const formId = useId();
  const slugId = `${formId}-slug`;
  const nameId = `${formId}-name`;
  const slugErrorId = `${slugId}-error`;
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");

  const trimmedSlug = slug.trim();

  const slugPatternError = SLUG_PATTERN.test(trimmedSlug) ? null : strings.slugHint;
  const slugError = trimmedSlug === "" ? strings.slugRequired : slugPatternError;

  const submittable = slugError === null && !pending;

  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          onClose();
        }
      }}
      title={strings.title}
      description={strings.description}
      closeLabel={strings.close}
      dismissOnBackdrop={!pending}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <AdminSecondaryButton
            type="button"
            disabled={!submittable}
            aria-busy={pending}
            aria-describedby={slugError === null ? undefined : slugErrorId}
            onClick={() => {
              onCreate({
                slug: trimmedSlug,
                name: name.trim() === "" ? trimmedSlug : name.trim(),
              });
            }}
          >
            {pending ? strings.creating : strings.create}
          </AdminSecondaryButton>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={slugId} className="text-sm font-semibold">
            {strings.slug}
          </label>
          <input
            id={slugId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            value={slug}
            aria-invalid={slugError !== null}
            aria-describedby={slugErrorId}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
            className={fieldClass}
          />
          <p id={slugErrorId} className="text-xs text-muted">
            {slugError ?? strings.slugHint}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="text-sm font-semibold">
            {strings.name}
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className={fieldClass}
          />
          <p className="text-xs text-muted">{strings.nameHint}</p>
        </div>
      </div>
      {failed ? (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {strings.createFailed}
        </p>
      ) : null}
    </AdminDialog>
  );
}
