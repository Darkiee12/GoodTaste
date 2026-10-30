import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select } from "radix-ui";
import { useId, type ReactNode } from "react";

export interface AdminSelectOption {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
}

export type AdminSelectSize = "compact" | "regular";

const TRIGGER_BASE_CLASS =
  "group inline-flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border-soft bg-white py-2 pr-2.5 pl-3 text-sm text-ink outline-none focus-visible:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-400";

const TRIGGER_SIZE_CLASS: ReadonlyMap<AdminSelectSize, string> = new Map([
  ["compact", "min-h-9"],
  ["regular", "min-h-11"],
]);

const ITEM_BASE_CLASS =
  "relative flex cursor-pointer items-center gap-2 rounded-md pr-2.5 pl-8 text-sm text-ink outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-cream motion-reduce:transition-none";

const ITEM_SIZE_CLASS: ReadonlyMap<AdminSelectSize, string> = new Map([
  ["compact", "py-1.5"],
  ["regular", "py-2"],
]);

/**
 * Canonical Feast Lab select. Radix Select supplies the listbox behavior,
 * typeahead, Escape/outside dismissal, and focus restore — no custom
 * positioning or event listeners here. The chevron rotation is driven by the
 * trigger's own `data-state` (open/closed as Radix reports it), never by
 * focus/blur heuristics, so it stays correct after Escape, outside click,
 * or disable-while-open.
 */
export function AdminSelect({
  ariaLabel,
  describedBy,
  disabled,
  id,
  invalid,
  labelledBy,
  onOpenChange,
  onValueChange,
  open,
  options,
  placeholder,
  required,
  size,
  triggerClassName,
  value,
}: {
  readonly ariaLabel?: string;
  readonly describedBy?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly invalid?: boolean;
  readonly labelledBy?: string;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onValueChange: (value: string) => void;
  readonly open?: boolean;
  readonly options: ReadonlyArray<AdminSelectOption>;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly size?: AdminSelectSize;
  readonly triggerClassName?: string;
  readonly value: string | undefined;
}): ReactNode {
  const resolvedSize = size ?? "regular";
  const triggerSize = TRIGGER_SIZE_CLASS.get(resolvedSize) ?? "min-h-11";
  const itemSize = ITEM_SIZE_CLASS.get(resolvedSize) ?? "py-2";

  return (
    <Select.Root
      value={value ?? ""}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      required={required}
    >
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid ?? false}
        aria-required={required ?? false}
        className={`${TRIGGER_BASE_CLASS} ${triggerSize} ${triggerClassName ?? "w-full"}`}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon asChild>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-[min(16rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border-soft bg-white shadow-lg"
        >
          <Select.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-muted">
            <ChevronUpIcon aria-hidden="true" className="size-4" />
          </Select.ScrollUpButton>
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className={`${ITEM_BASE_CLASS} ${itemSize} data-[state=checked]:font-semibold`}
              >
                <Select.ItemIndicator className="absolute left-2 inline-flex items-center text-food-orange-dark">
                  <CheckIcon aria-hidden="true" className="size-4" />
                </Select.ItemIndicator>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-muted">
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * Labeled composition over AdminSelect. The visible `<label>` targets the
 * Radix trigger button directly (buttons are labelable), so clicking the
 * label opens the menu; description, error, and required wiring mirrors
 * the native AdminSelect contract.
 */
export function AdminSelectField({
  description,
  error,
  id,
  label,
  onValueChange,
  options,
  placeholder,
  required,
  size,
  triggerClassName,
  value,
  disabled,
  open,
  onOpenChange,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly error?: string | null;
  readonly id?: string;
  readonly label: string;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onValueChange: (value: string) => void;
  readonly open?: boolean;
  readonly options: ReadonlyArray<AdminSelectOption>;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly size?: AdminSelectSize;
  readonly triggerClassName?: string;
  readonly value: string | undefined;
}): ReactNode {
  const generatedId = useId();
  const triggerId = id ?? `admin-select-${generatedId}`;
  const descriptionId = description === undefined ? undefined : `${triggerId}-description`;
  const errorId = `${triggerId}-error`;
  const failure = error ?? null;

  const describedBy = [descriptionId, failure !== null ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={triggerId} className="text-sm font-semibold">
        {label}
        {required === true ? (
          <span aria-hidden="true" className="text-food-orange-dark">
            {" *"}
          </span>
        ) : null}
      </label>
      {description === undefined ? null : (
        <p id={descriptionId} className="text-sm text-muted">
          {description}
        </p>
      )}
      <AdminSelect
        id={triggerId}
        value={value}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        invalid={failure !== null}
        describedBy={describedBy === "" ? undefined : describedBy}
        required={required}
        size={size}
        triggerClassName={triggerClassName}
        open={open}
        onOpenChange={onOpenChange}
      />
      {failure !== null ? (
        <p id={errorId} role="alert" className="text-sm font-semibold text-red-800">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
