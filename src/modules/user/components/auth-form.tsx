import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { signInFn, signUpFn, socialSignInFn } from "@/modules/user/user.functions";
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
}

/**
 * Email/password form with Google/Facebook buttons. All authentication runs
 * through TanStack server functions; the browser never sees session tokens.
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
  const failure = credentials.error ?? social.error;

  let error: string | null = null;

  if (failure !== null) {
    error = mode === "sign-up" ? "sign-up failed" : "sign-in failed";
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    credentials.mutate({ email, password, name });
  };

  return (
    <div className="auth-form">
      <h1>{copy.heading}</h1>
      <div className="auth-social">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            social.mutate("google");
          }}
        >
          {copy.google}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            social.mutate("facebook");
          }}
        >
          {copy.facebook}
        </button>
      </div>
      <form
        onSubmit={(event) => {
          submit(event);
        }}
      >
        {mode === "sign-up" ? (
          <label>
            {copy.name}
            <input
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          {copy.email}
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          {copy.password}
          <input
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error !== null ? (
          <p role="alert" className="auth-error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {copy.submit}
        </button>
      </form>
      <p>
        <a href={copy.switchHref}>{copy.switchText}</a>
      </p>
      {mode === "sign-in" ? (
        <p>
          <a href={copy.forgotHref}>{copy.forgotText}</a>
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
      };
