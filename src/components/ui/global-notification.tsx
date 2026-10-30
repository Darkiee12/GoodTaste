import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type GlobalNotificationVariant = "error" | "success" | "warning" | "info";

interface VariantTone {
  readonly bar: string;
  readonly icon: ReactNode;
}

const VARIANT_TONES: ReadonlyMap<GlobalNotificationVariant, VariantTone> = new Map([
  [
    "error",
    {
      bar: "bg-red-700 text-white",
      icon: <AlertCircle aria-hidden="true" className="size-5 shrink-0" />,
    },
  ],
  [
    "success",
    {
      bar: "bg-green-700 text-white",
      icon: <CheckCircle aria-hidden="true" className="size-5 shrink-0" />,
    },
  ],
  [
    "warning",
    {
      bar: "bg-amber-600 text-white",
      icon: <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />,
    },
  ],
  [
    "info",
    {
      bar: "bg-brand-blue text-white",
      icon: <Info aria-hidden="true" className="size-5 shrink-0" />,
    },
  ],
]);

const toneFor = (variant: GlobalNotificationVariant): VariantTone => {
  const tone = VARIANT_TONES.get(variant);

  if (tone !== undefined) {
    return tone;
  }

  const fallback = VARIANT_TONES.get("info");

  if (fallback === undefined) {
    throw new Error("GlobalNotification is missing its info tone");
  }

  return fallback;
};

/**
 * Reusable viewport-top notification rendered through a portal to
 * `document.body`, so it is never clipped by an ancestor with overflow or
 * transform and stays visible while the page scrolls.
 *
 * - One assertive live region: the container carries `role="alert"`.
 *   Field-level callers must NOT add a second `role="alert"`; they keep a
 *   concise hint (e.g. "Upload failed — see message above") with
 *   `aria-describedby` pointing at this banner's `id`.
 * - Blocking `error` notifications persist until dismissed or resolved —
 *   never auto-dismiss an error. `success`/`warning`/`info` may pass
 *   `autoDismissMs` for transient confirmation.
 * - z-index: `z-[70]` sits above the sticky site header (`z-50`), the
 *   AdminDialog overlay/content (`z-50`), and the skip link (`z-[60]`).
 *   A global failure banner must remain reachable and visible even when a
 *   modal dialog is open, and it must win over the skip link on first paint;
 *   nothing else in the app layers above `z-[60]`, so `z-[70]` is the top
 *   layer by construction.
 */
export function GlobalNotification({
  variant,
  title,
  description,
  onClose,
  closeLabel = "Dismiss notification",
  autoDismissMs,
  id = "global-notification",
}: {
  readonly variant: GlobalNotificationVariant;
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly closeLabel?: string;
  /** Transient variants only; ignored for `error` (blocking by design). */
  readonly autoDismissMs?: number;
  readonly id?: string;
}): ReactNode {
  // SSR-safe mount gate without setState-in-effect: the server snapshot is
  // `false` (render null, matching SSR HTML) and the client snapshot is
  // `true`, so the portal mounts on the first post-hydration render.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (variant === "error" || autoDismissMs === undefined) {
      return () => undefined;
    }

    const timer = window.setTimeout(onClose, autoDismissMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [variant, autoDismissMs, onClose]);

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  const tone = toneFor(variant);

  return createPortal(
    <div
      id={id}
      role="alert"
      className={`fixed top-0 right-0 left-0 z-[70] w-full ${tone.bar} pt-[env(safe-area-inset-top)]`}
    >
      <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-3">
        <span className="mt-0.5">{tone.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-0.5 text-sm">{description}</p>
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
