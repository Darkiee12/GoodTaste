/**
 * Binary file-size formatter for user-facing messages.
 *
 * Uses binary units (1 KiB = 1024 bytes, 1 MiB = 1048576 bytes) so the
 * displayed limit matches the exact byte constants enforced server-side
 * (e.g. `MAX_IMPORT_FILE_BYTES`). Decimal MB/MB-approx labels drift from
 * the enforced value; binary labels do not.
 *
 * Never throws: non-finite, negative, and NaN inputs render as "0 B".
 */

const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

const trim = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < KIB) {
    return `${Math.floor(bytes)} B`;
  }

  if (bytes < MIB) {
    return `${trim(bytes / KIB)} KiB`;
  }

  if (bytes < GIB) {
    return `${trim(bytes / MIB)} MiB`;
  }

  return `${trim(bytes / GIB)} GiB`;
};
