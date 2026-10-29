import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { signInFn, signUpFn, socialSignInFn } from "@/modules/user/auth.functions";
import type { Messages } from "@/shared/i18n";

interface AuthFormCopy {
  readonly heading: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly submit: string;
  readonly google: string;
  readonly facebook: string;
  readonly switchText: string;
  readonly switchHref: string;
  readonly forgotHref: string;
  readonly forgotText: string;
  readonly authCreatingAccount: string;
  readonly authSignInFailed: string;
  readonly authSignUpFailed: string;
  readonly authSigningIn: string;
  readonly authSocialFailed: string;
  readonly commonRetry: string;
}

const inputClass =
  "mt-1 w-full min-w-0 rounded-md border border-border-soft bg-white px-3 py-2 text-base text-ink motion-safe:transition-colors focus:border-brand-blue";

const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors";

const oauthButtonClass =
  "inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors";

/**
 * Email/password form with Google/Facebook buttons. All authentication runs
 * through TanStack server functions; the browser never sees session tokens.
 *
 * Failures stay generic on purpose: the form never reveals whether an email
 * is registered, and never surfaces raw provider payloads.
 */
export function AuthForm({
  mode,
  copy,
  returnTo,
}: {
  readonly mode: "sign-in" | "sign-up";
  readonly copy: AuthFormCopy;
  readonly returnTo: string;
}) {
  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const nameId = `${formId}-name`;
  const emailErrorId = `${formId}-email-error`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const credentials = useMutation({
    mutationFn: (input: { email: string; password: string; name: string }) =>
      mode === "sign-up" ? signUpFn({ data: input }) : signInFn({ data: input }),
    onSuccess: () => {
      window.location.assign(mode === "sign-up" ? "/verify-email" : returnTo);
    },
  });

  const social = useMutation({
    mutationFn: (provider: "google" | "facebook") =>
      socialSignInFn({ data: { provider, callbackURL: returnTo } }),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });

  const pending = credentials.isPending || social.isPending;

  // Privacy-safe: one generic message per channel, no account-existence leaks.
  let failure: string | null = null;

  if (social.isError) {
    failure = copy.authSocialFailed;
  } else if (credentials.isError) {
    failure = mode === "sign-up" ? copy.authSignUpFailed : copy.authSignInFailed;
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    credentials.mutate({ email, password, name });
  };

  let submitLabel = copy.submit;

  if (credentials.isPending) {
    submitLabel = mode === "sign-up" ? copy.authCreatingAccount : copy.authSigningIn;
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-lg border border-border-soft bg-white p-6 shadow-sm">
        <h1 className="font-display text-4xl tracking-wide">{copy.heading}</h1>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className={oauthButtonClass}
            disabled={pending}
            aria-busy={social.isPending}
            onClick={() => {
              social.mutate("google");
            }}
          >
            {copy.google}
          </button>
          <button
            type="button"
            className={oauthButtonClass}
            disabled={pending}
            aria-busy={social.isPending}
            onClick={() => {
              social.mutate("facebook");
            }}
          >
            {copy.facebook}
          </button>
        </div>
        <div aria-hidden="true" className="my-5 border-t border-border-soft" />
        <form
          onSubmit={(event) => {
            submit(event);
          }}
        >
          <div className="grid gap-4">
            {mode === "sign-up" ? (
              <div>
                <label htmlFor={nameId} className="block text-sm font-medium">
                  {copy.name}
                </label>
                <input
                  id={nameId}
                  name="name"
                  type="text"
                  autoComplete="name"
                  spellCheck={false}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClass}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor={emailId} className="block text-sm font-medium">
                {copy.email}
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                required
                aria-invalid={failure !== null}
                aria-describedby={failure !== null ? emailErrorId : undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={passwordId} className="block text-sm font-medium">
                {copy.password}
              </label>
              <input
                id={passwordId}
                name={mode === "sign-up" ? "new-password" : "current-password"}
                type="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                required
                minLength={8}
                aria-invalid={failure !== null}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          {failure !== null ? (
            <div
              role="alert"
              id={emailErrorId}
              className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <p>{failure}</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <button
                  type="button"
                  className="font-medium underline hover:no-underline"
                  onClick={() => {
                    credentials.reset();
                    social.reset();
                  }}
                >
                  {copy.commonRetry}
                </button>
                {mode === "sign-in" ? (
                  <a href={copy.forgotHref} className="font-medium underline hover:no-underline">
                    {copy.forgotText}
                  </a>
                ) : null}
              </p>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={`${primaryButtonClass} mt-4`}
          >
            {submitLabel}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-sm">
        <a href={copy.switchHref} className="text-brand-blue underline hover:no-underline">
          {copy.switchText}
        </a>
      </p>
      {mode === "sign-in" ? (
        <p className="mt-2 text-center text-sm">
          <a href={copy.forgotHref} className="text-brand-blue underline hover:no-underline">
            {copy.forgotText}
          </a>
        </p>
      ) : null}
    </div>
  );
}

export const authFormCopy = (
  messages: Messages,
  mode: "sign-in" | "sign-up",
  returnTo: string,
): AuthFormCopy =>
  mode === "sign-up"
    ? {
        heading: messages.authSignUpHeading,
        email: messages.authEmail,
        password: messages.authPassword,
        name: messages.authName,
        submit: messages.authSignUp,
        google: messages.authContinueGoogle,
        facebook: messages.authContinueFacebook,
        switchText: messages.authHaveAccount,
        switchHref: `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
        forgotHref: "/forgot-password",
        forgotText: messages.authForgot,
        authCreatingAccount: messages.authCreatingAccount,
        authSignInFailed: messages.authSignInFailed,
        authSignUpFailed: messages.authSignUpFailed,
        authSigningIn: messages.authSigningIn,
        authSocialFailed: messages.authSocialFailed,
        commonRetry: messages.commonRetry,
      }
    : {
        heading: messages.authSignInHeading,
        email: messages.authEmail,
        password: messages.authPassword,
        name: messages.authName,
        submit: messages.authSignIn,
        google: messages.authContinueGoogle,
        facebook: messages.authContinueFacebook,
        switchText: messages.authNoAccount,
        switchHref: `/sign-up?returnTo=${encodeURIComponent(returnTo)}`,
        forgotHref: "/forgot-password",
        forgotText: messages.authForgot,
        authCreatingAccount: messages.authCreatingAccount,
        authSignInFailed: messages.authSignInFailed,
        authSignUpFailed: messages.authSignUpFailed,
        authSigningIn: messages.authSigningIn,
        authSocialFailed: messages.authSocialFailed,
        commonRetry: messages.commonRetry,
      };
