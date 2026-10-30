import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import type { PermissionEntry } from "@/components/admin/roles/permission-catalog";
import {
  draftOf,
  type RoleDraft,
  type RoleEntry,
  type RolesCapabilities,
} from "@/components/admin/roles/role-types";
import { AdminGhostButton, AdminSecondaryButton } from "@/components/admin/ui";

export interface RoleEditorStrings {
  readonly overview: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly colorHint: string;
  readonly position: string;
  readonly permissions: string;
  readonly grantsCount: (granted: number, total: number) => string;
  readonly sensitive: string;
  readonly system: string;
  readonly custom: string;
  readonly protectedBadge: string;
  readonly protectedNote: string;
  readonly members: string;
  readonly saveChanges: string;
  readonly saving: string;
  readonly partialSaved: string;
  readonly deleteRole: string;
  readonly deleteForbidden: string;
  readonly emptySelection: string;
  readonly discardChanges: string;
  readonly nameRequired: string;
  readonly colorInvalid: string;
  readonly backToList: string;
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface DraftFieldErrors {
  name?: string;
  color?: string;
}

export const validateDraft = (
  draft: RoleDraft,
  strings: Pick<RoleEditorStrings, "nameRequired" | "colorInvalid">,
): DraftFieldErrors => {
  const errors: DraftFieldErrors = {};

  if (draft.name.trim() === "") {
    errors.name = strings.nameRequired;
  }

  if (!COLOR_PATTERN.test(draft.color.trim())) {
    errors.color = strings.colorInvalid;
  }

  return errors;
};

const inputClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm text-ink";

/**
 * Right-pane role editor: stable header (name/type/actions), an Overview
 * section for metadata, and a grouped Permissions section. Read-only when
 * the caller lacks mutation grants.
 */
export function RoleEditor({
  role,
  draft,
  catalog,
  totalPermissions,
  dirty,
  saving,
  partialFailure,
  capabilities,
  fieldErrors,
  strings,
  onPatch,
  onToggleGrant,
  onSave,
  onDelete,
  onBack,
}: {
  readonly role: RoleEntry;
  readonly draft: RoleDraft;
  readonly catalog: ReadonlyMap<string, ReadonlyArray<PermissionEntry>>;
  readonly totalPermissions: number;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly partialFailure: boolean;
  readonly capabilities?: RolesCapabilities;
  readonly fieldErrors: DraftFieldErrors;
  readonly strings: RoleEditorStrings;
  readonly onPatch: (patch: Partial<RoleDraft>) => void;
  readonly onToggleGrant: (key: string) => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onBack: () => void;
}): ReactNode {
  const nameErrorId = `role-name-error-${role.id}`;
  const colorErrorId = `role-color-error-${role.id}`;
  const canEditMeta = capabilities?.canUpdate ?? false;
  const canEditGrants = capabilities?.canManagePermissions ?? false;
  const canDelete = capabilities?.canDelete ?? false;
  const fullyReadOnly = !canEditMeta && !canEditGrants;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-border-soft bg-white">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-soft px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-9 cursor-pointer items-center rounded-md px-2 text-sm font-semibold text-brand-blue hover:bg-cream md:hidden"
        >
          ← {strings.backToList}
        </button>
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-full border border-black/10"
          style={{ backgroundColor: draft.color }}
        />
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{role.name}</h2>
        <span className="shrink-0 rounded-full border border-border-soft bg-cream px-2 py-0.5 text-xs font-semibold text-muted">
          {role.isSystem ? strings.system : strings.custom}
          {role.isProtected ? ` · ${strings.protectedBadge}` : null}
        </span>
        {canDelete ? (
          <button
            type="button"
            disabled={role.isSystem || saving}
            title={role.isSystem ? strings.deleteForbidden : undefined}
            onClick={onDelete}
            className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {strings.deleteRole}
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {role.isProtected ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {strings.protectedNote}
          </p>
        ) : null}
        {partialFailure ? (
          <output className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {strings.partialSaved}
          </output>
        ) : null}

        <section aria-label={strings.overview}>
          <h3 className="text-sm font-bold tracking-wide text-ink uppercase">{strings.overview}</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`role-name-${role.id}`} className="text-sm font-semibold">
                {strings.name}
              </label>
              <input
                id={`role-name-${role.id}`}
                name={`roleName-${role.slug}`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                disabled={!canEditMeta || saving}
                value={draft.name}
                aria-invalid={fieldErrors.name !== undefined}
                aria-describedby={fieldErrors.name === undefined ? undefined : nameErrorId}
                onChange={(event) => {
                  onPatch({ name: event.target.value });
                }}
                className={inputClass}
              />
              {fieldErrors.name === undefined ? null : (
                <p id={nameErrorId} className="text-sm font-semibold text-red-800">
                  {fieldErrors.name}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`role-description-${role.id}`} className="text-sm font-semibold">
                {strings.description}
              </label>
              <input
                id={`role-description-${role.id}`}
                name={`roleDescription-${role.slug}`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                disabled={!canEditMeta || saving}
                value={draft.description}
                onChange={(event) => {
                  onPatch({ description: event.target.value });
                }}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`role-color-${role.id}`} className="text-sm font-semibold">
                {strings.color}
              </label>
              <div className="mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-border-soft bg-white px-2">
                <input
                  id={`role-color-${role.id}`}
                  name={`roleColor-${role.slug}`}
                  type="color"
                  disabled={!canEditMeta || saving}
                  value={COLOR_PATTERN.test(draft.color) ? draft.color : "#6b7280"}
                  aria-describedby={colorErrorId}
                  onChange={(event) => {
                    onPatch({ color: event.target.value });
                  }}
                  className="size-8 shrink-0 cursor-pointer rounded border border-border-soft bg-white p-0.5 disabled:cursor-not-allowed"
                />
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!canEditMeta || saving}
                  value={draft.color}
                  aria-label={strings.color}
                  aria-invalid={fieldErrors.color !== undefined}
                  inputMode="text"
                  onChange={(event) => {
                    onPatch({ color: event.target.value });
                  }}
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none"
                />
              </div>
              <p id={colorErrorId} className="text-xs text-muted">
                {fieldErrors.color ?? strings.colorHint}
              </p>
              {fieldErrors.color === undefined ? null : (
                <p className="text-sm font-semibold text-red-800">{fieldErrors.color}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`role-position-${role.id}`} className="text-sm font-semibold">
                {strings.position}
              </label>
              <input
                id={`role-position-${role.id}`}
                name={`rolePosition-${role.slug}`}
                type="text"
                autoComplete="off"
                inputMode="numeric"
                disabled={!canEditMeta || saving}
                value={draft.position}
                onChange={(event) => {
                  onPatch({ position: event.target.value });
                }}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        <section aria-label={strings.permissions}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold tracking-wide text-ink uppercase">
              {strings.permissions}
            </h3>
            <p className="text-xs text-muted">
              {strings.grantsCount(draft.permissions.length, totalPermissions)}
            </p>
          </div>
          <div className="mt-2 space-y-3">
            {[...catalog.entries()].map(([group, entries]) => (
              <fieldset key={group} className="rounded-lg border border-border-soft px-3 py-2">
                <legend className="px-1 text-sm font-bold text-ink">{group}</legend>
                <div className="grid gap-1 py-1">
                  {entries.map((entry, index) => {
                    const checked = draft.permissions.includes(entry.key);

                    return (
                      <label
                        key={entry.key}
                        htmlFor={`role-grant-${role.id}-${index}`}
                        className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                          entry.dangerous ? "border border-amber-200 bg-amber-50/60" : ""
                        } ${!canEditGrants || saving ? "cursor-default opacity-70" : "hover:bg-cream"}`}
                      >
                        <input
                          id={`role-grant-${role.id}-${index}`}
                          type="checkbox"
                          checked={checked}
                          disabled={!canEditGrants || saving}
                          onChange={() => {
                            onToggleGrant(entry.key);
                          }}
                          className="mt-1 shrink-0 accent-brand-blue"
                        />
                        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
                          {entry.displayName}{" "}
                          {entry.dangerous ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-900">
                              <AlertTriangle aria-hidden="true" className="size-3" />
                              {strings.sensitive}
                            </span>
                          ) : null}
                          <span className="block text-xs font-normal text-muted">
                            {entry.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      </div>

      {fullyReadOnly ? null : (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-soft px-4 py-3">
          <AdminGhostButton
            type="button"
            disabled={!dirty || saving}
            onClick={() => {
              onPatch(draftOf(role));
            }}
          >
            {strings.discardChanges}
          </AdminGhostButton>
          <AdminSecondaryButton
            type="button"
            disabled={!dirty || saving}
            aria-busy={saving}
            onClick={onSave}
          >
            {saving ? strings.saving : strings.saveChanges}
          </AdminSecondaryButton>
        </footer>
      )}
    </div>
  );
}
