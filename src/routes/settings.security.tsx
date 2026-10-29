import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useId, useState } from "react";

import { changePasswordFn } from "@/modules/user/auth.functions";
import {
  listSessionsFn,
  revokeAllSessionsFn,
  revokeOtherSessionsFn,
  revokeSessionFn,
} from "@/modules/user/session.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/settings/security")({
  beforeLoad: async ({ context, search }) => {
    if (context.session.status === "signed-out") {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/settings/security", lang: search.lang },
      });
    }

    if (context.session.status === "unavailable") {
      // SAFETY: literal unavailable marker for the component's discriminated
      // union branch; no untrusted input is asserted.
      return { unavailable: true } as const;
    }

    // SAFETY: literal loaded marker; session state comes from the verified
    // root context.
    return { unavailable: false } as const;
  },
  loader: async ({ context }) => {
    if ("unavailable" in context && context.unavailable) {
      // SAFETY: literal unavailable marker for the component's discriminated
      // union branch; no untrusted input is asserted.
      return { sessions: [], unavailable: true } as const;
    }

    // SAFETY: literal loaded marker; session rows come from the authenticated
    // server function.
    return { sessions: await listSessionsFn(), unavailable: false } as const;
  },
  component: SecuritySettings,
});

const inputClass =
  "mt-1 w-full min-w-0 rounded-md border border-border-soft bg-white px-3 py-2 text-base text-ink motion-safe:transition-colors focus:border-brand-blue";

function SecuritySettings() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const loaderData = Route.useLoaderData();
  const formId = useId();

  const unavailable = "unavailable" in loaderData && loaderData.unavailable;

  const currentPasswordId = `${formId}-current-password`;
  const newPasswordId = `${formId}-new-password`;
  const passwordErrorId = `${formId}-password-error`;
  const sessionsErrorId = `${formId}-sessions-error`;

  const [sessions, setSessions] = useState(loaderData.sessions);

  const [currentPassword, setCurrentPassword] = useState("");

  const [newPassword, setNewPassword] = useState("");

  const [confirming, setConfirming] = useState<"others" | "all" | null>(null);

  const refreshSessions = useMutation({
    mutationFn: () => listSessionsFn(),
    onSuccess: (rows) => {
      setSessions(rows);
    },
  });

  const changePassword = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      changePasswordFn({ data: input }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
    },
  });

  const revokeOne = useMutation({
    mutationFn: (sessionId: string) => revokeSessionFn({ data: { session_id: sessionId } }),
    onSuccess: () => {
      refreshSessions.mutate();
    },
  });

  const submitPasswordChange = (event: React.FormEvent): void => {
    event.preventDefault();
    changePassword.mutate({ currentPassword, newPassword });
  };

  const revokeOthers = useMutation({
    mutationFn: () => revokeOtherSessionsFn(),
    onSuccess: () => {
      setConfirming(null);
      refreshSessions.mutate();
    },
  });

  const revokeAll = useMutation({
    mutationFn: () => revokeAllSessionsFn(),
    onSuccess: () => {
      window.location.assign("/sign-in");
    },
  });

  let sessionsError: string | null = null;

  if (revokeAll.isError) {
    sessionsError = copy.securityRevokeAllFailed;
  } else if (revokeOthers.isError) {
    sessionsError = copy.securityRevokeOthersFailed;
  } else if (revokeOne.isError || refreshSessions.isError) {
    sessionsError = copy.securityRevokeFailed;
  }

  if (unavailable) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="font-display text-4xl tracking-wide">{copy.authSecurity}</h1>

        <p
          role="note"
          className="mt-4 rounded-lg border border-mango/40 bg-cream px-4 py-3 text-sm font-semibold text-ink"
        >
          Sign-in status is unavailable — we did not sign you out. Try again shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="font-display text-4xl tracking-wide">{copy.authSecurity}</h1>
      <section
        aria-labelledby={`${formId}-password-heading`}
        className="mt-6 rounded-lg border border-border-soft bg-white p-6 shadow-sm"
      >
        <h2 id={`${formId}-password-heading`} className="font-display text-2xl tracking-wide">
          {copy.authChangePassword}
        </h2>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            submitPasswordChange(event);
          }}
        >
          <div>
            <label htmlFor={currentPasswordId} className="block text-sm font-medium">
              {copy.authCurrentPassword}
            </label>
            <input
              id={currentPasswordId}
              name="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={newPasswordId} className="block text-sm font-medium">
              {copy.authNewPassword}
            </label>
            <input
              id={newPasswordId}
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={changePassword.isError}
              aria-describedby={changePassword.isError ? passwordErrorId : undefined}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass}
            />
          </div>
          {changePassword.isError ? (
            <div
              role="alert"
              id={passwordErrorId}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <p>{copy.authChangeFailed}</p>
              <button
                type="button"
                className="mt-2 font-medium underline hover:no-underline"
                onClick={() => {
                  changePassword.reset();
                }}
              >
                {copy.commonRetry}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={changePassword.isPending}
              aria-busy={changePassword.isPending}
              className="inline-flex items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {changePassword.isPending ? copy.authChanging : copy.authChangePassword}
            </button>
            {changePassword.isSuccess ? (
              <output className="text-sm text-green-800">{copy.authPasswordChanged}</output>
            ) : null}
          </div>
        </form>
      </section>
      <section
        aria-labelledby={`${formId}-sessions-heading`}
        className="mt-6 rounded-lg border border-border-soft bg-white p-6 shadow-sm"
      >
        <h2 id={`${formId}-sessions-heading`} className="font-display text-2xl tracking-wide">
          {copy.authSessions}
        </h2>
        <ul className="mt-3 grid gap-2">
          {sessions.map((entry) => (
            <li
              key={entry.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft px-3 py-2"
            >
              <span className="min-w-0 break-words text-sm">
                {entry.userAgent ?? entry.id.slice(0, 8)}
                {entry.current ? ` (${copy.authCurrentSession})` : null}
              </span>
              {entry.current ? null : (
                <button
                  type="button"
                  disabled={revokeOne.isPending}
                  aria-busy={revokeOne.isPending}
                  onClick={() => {
                    revokeOne.mutate(entry.id);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                >
                  {copy.authRevoke}
                </button>
              )}
            </li>
          ))}
        </ul>
        {sessionsError !== null ? (
          <div
            role="alert"
            id={sessionsErrorId}
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <p>{sessionsError}</p>
            <p className="mt-2">
              <button
                type="button"
                className="font-medium underline hover:no-underline"
                onClick={() => {
                  refreshSessions.reset();
                  revokeOne.reset();
                  revokeOthers.reset();
                  revokeAll.reset();
                  refreshSessions.mutate();
                }}
              >
                {copy.adminRefresh}
              </button>
            </p>
          </div>
        ) : null}
        {confirming !== null ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <p>
              {confirming === "all"
                ? copy.securityRevokeAllConfirm
                : copy.securityRevokeOthersConfirm}
            </p>
            <p className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={revokeOthers.isPending || revokeAll.isPending}
                onClick={() => {
                  if (confirming === "all") {
                    revokeAll.mutate();
                  } else {
                    revokeOthers.mutate();
                  }
                }}
                className="inline-flex items-center justify-center rounded-md bg-brand-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
              >
                {copy.commonConfirm}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                }}
                className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream motion-safe:transition-colors"
              >
                {copy.commonCancel}
              </button>
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={revokeOthers.isPending}
              aria-busy={revokeOthers.isPending}
              onClick={() => {
                setConfirming("others");
              }}
              className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-4 py-2 text-sm font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {copy.authRevokeOthers}
            </button>
            <button
              type="button"
              disabled={revokeAll.isPending}
              aria-busy={revokeAll.isPending}
              onClick={() => {
                setConfirming("all");
              }}
              className="inline-flex items-center justify-center rounded-md border border-red-700 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {copy.authSignOut}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
