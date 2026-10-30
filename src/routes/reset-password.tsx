import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { z } from "zod";

import { resetPasswordFn } from "@/modules/user/auth.functions";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const resetSearch = localeSearchSchema.extend({
  token: z.string().default(""),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: resetSearch,
  component: ResetPassword,
});

function ResetPassword() {
  const { lang } = rootRoute.useSearch();
  const { token } = Route.useSearch();
  const copy = messagesFor(lang);
  const formId = useId();
  const passwordId = `${formId}-password`;
  const errorId = `${formId}-error`;
  const [password, setPassword] = useState("");

  const reset = useMutation({
    mutationFn: (newPassword: string) => resetPasswordFn({ data: { newPassword, token } }),
    onSuccess: () => {
      window.location.assign("/sign-in");
    },
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    reset.mutate(password);
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-lg border border-border-soft bg-white p-6 shadow-sm">
        <h1 className="font-display text-4xl tracking-wide">{copy.authResetHeading}</h1>
        {token.length === 0 ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <p>{copy.authResetNoToken}</p>
            <p className="mt-2">
              <Link
                to="/forgot-password"
                search={{ lang }}
                className="font-medium underline hover:no-underline"
              >
                {copy.authRequestNewLink}
              </Link>
            </p>
          </div>
        ) : (
          <form
            className="mt-4"
            onSubmit={(event) => {
              submit(event);
            }}
          >
            <div>
              <label htmlFor={passwordId} className="block text-sm font-medium">
                {copy.authNewPassword}
              </label>
              <input
                id={passwordId}
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                aria-invalid={reset.isError}
                aria-describedby={reset.isError ? errorId : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-md border border-border-soft bg-white px-3 py-2 text-base text-ink motion-safe:transition-colors focus:border-brand-blue"
              />
            </div>
            {reset.isError ? (
              <div
                role="alert"
                id={errorId}
                className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                <p>{copy.authResetFailed}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <button
                    type="button"
                    className="font-medium underline hover:no-underline"
                    onClick={() => {
                      reset.reset();
                    }}
                  >
                    {copy.commonRetry}
                  </button>
                  <Link
                    to="/forgot-password"
                    search={{ lang }}
                    className="font-medium underline hover:no-underline"
                  >
                    {copy.authRequestNewLink}
                  </Link>
                </p>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={reset.isPending}
              aria-busy={reset.isPending}
              className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {reset.isPending ? copy.authResetting : copy.authResetSubmit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
