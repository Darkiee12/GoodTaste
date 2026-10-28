import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useId, useState } from "react";

import { forgetPasswordFn } from "@/modules/user/auth.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const formId = useId();
  const emailId = `${formId}-email`;
  const errorId = `${formId}-error`;
  const [email, setEmail] = useState("");

  const request = useMutation({
    mutationFn: (input: { email: string }) =>
      forgetPasswordFn({ data: { ...input, redirectTo: "/reset-password" } }),
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    request.mutate({ email });
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-lg border border-border-soft bg-white p-6 shadow-sm">
        <h1 className="font-display text-4xl tracking-wide">{copy.authForgotHeading}</h1>
        {request.isSuccess ? (
          <output className="mt-4 block rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <p>{copy.authForgotSent}</p>
            <button
              type="button"
              className="mt-2 font-medium underline hover:no-underline"
              onClick={() => {
                request.reset();
              }}
            >
              {copy.authSendAgain}
            </button>
          </output>
        ) : (
          <form
            className="mt-4"
            onSubmit={(event) => {
              submit(event);
            }}
          >
            <div>
              <label htmlFor={emailId} className="block text-sm font-medium">
                {copy.authEmail}
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                required
                aria-invalid={request.isError}
                aria-describedby={request.isError ? errorId : undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full min-w-0 rounded-md border border-border-soft bg-white px-3 py-2 text-base text-ink motion-safe:transition-colors focus:border-brand-blue"
              />
            </div>
            {request.isError ? (
              <div
                role="alert"
                id={errorId}
                className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                <p>{copy.authForgotFailed}</p>
                <button
                  type="button"
                  className="mt-2 font-medium underline hover:no-underline"
                  onClick={() => {
                    request.reset();
                  }}
                >
                  {copy.commonRetry}
                </button>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={request.isPending}
              aria-busy={request.isPending}
              className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {request.isPending ? copy.authSending : copy.authSendLink}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
