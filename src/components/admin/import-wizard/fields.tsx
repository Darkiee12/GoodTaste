import type { ReactNode } from "react";

import { AdminSelect } from "@/components/admin/ui";

const describedByFor = (
  id: string,
  hint: string | undefined,
  error: string | null,
): string | undefined => {
  const parts: Array<string> = [];

  if (hint !== undefined) {
    parts.push(`${id}-hint`);
  }

  if (error !== null && error !== "") {
    parts.push(`${id}-error`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
};

interface TextFieldProps {
  readonly error?: string | null;
  readonly hint?: string;
  readonly id: string;
  readonly inputMode?: "text" | "url";
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly value: string;
}

export function TextField({
  error,
  hint,
  id,
  inputMode,
  label,
  onChange,
  required,
  value,
}: TextFieldProps): ReactNode {
  const failure = error ?? null;

  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      {hint !== undefined ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        value={value}
        inputMode={inputMode ?? "text"}
        required={required ?? false}
        aria-invalid={failure !== null}
        aria-describedby={describedByFor(id, hint, failure)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="mt-1 block min-h-11 w-full rounded-lg border border-border-soft bg-white px-3 text-sm text-ink outline-none focus-visible:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40"
      />
      {failure !== null ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-semibold text-red-700">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  readonly hint?: string;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly value: string;
}

export function SelectField({
  hint,
  id,
  label,
  onChange,
  options,
  value,
}: SelectFieldProps): ReactNode {
  // Single shared select presentation (see AdminSelect): one decorative
  // chevron, identical padding/radius/focus/disabled states everywhere.
  return (
    <div className="mt-4">
      <AdminSelect
        id={id}
        label={label}
        hint={hint}
        value={value}
        onChange={onChange}
        options={options}
      />
    </div>
  );
}

interface TextAreaFieldProps {
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}

export function TextAreaField({ id, label, onChange, value }: TextAreaFieldProps): ReactNode {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={3}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="mt-1 block min-h-11 w-full rounded-lg border border-border-soft bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40"
      />
    </div>
  );
}

interface AckCheckboxProps {
  readonly checked: boolean;
  readonly id: string;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}

export function AckCheckbox({ checked, id, label, onChange }: AckCheckboxProps): ReactNode {
  return (
    <label htmlFor={id} className="mt-3 flex min-h-11 cursor-pointer items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-1 h-5 w-5 shrink-0"
      />
      <span>{label}</span>
    </label>
  );
}
