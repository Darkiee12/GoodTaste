import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useState } from "react";

import {
  getProfileFn,
  getSessionFn,
  listAccountsFn,
  signOutFn,
  unlinkAccountFn,
  updateProfileFn,
} from "@/modules/user/user.functions";
import { messagesFor, locales } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";

const isLocale = (value: string): value is Locale =>
  // SAFETY: narrows free-form UI input against the fixed locale vocabulary.
  (locales as ReadonlyArray<string>).includes(value);

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/settings/account")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/settings/account", lang: search.lang },
      });
    }

    return { user: session.user };
  },
  loader: async () => {
    const [profile, linked] = await Promise.all([getProfileFn(), listAccountsFn()]);

    return { profile, accounts: linked.accounts };
  },
  component: AccountSettings,
});

function AccountSettings() {
  const { lang } = rootRoute.useSearch();
  const { user } = Route.useRouteContext();
  const { profile, accounts: initialAccounts } = Route.useLoaderData();
  const copy = messagesFor(lang);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? user.name);
  const [locale, setLocale] = useState<Locale>(profile?.locale ?? lang);
  const [accounts, setAccounts] = useState(initialAccounts);

  const saveProfile = useMutation({
    mutationFn: (input: { displayName: string | null; locale: Locale }) =>
      updateProfileFn({
        data: { display_name: input.displayName, locale: input.locale },
      }),
  });

  const unlink = useMutation({
    mutationFn: (accountId: string) => unlinkAccountFn({ data: { account_id: accountId } }),
    onSuccess: (_data, accountId) => {
      setAccounts(accounts.filter((other) => other.accountId !== accountId));
    },
  });

  const save = (event: React.FormEvent): void => {
    event.preventDefault();
    saveProfile.mutate({ displayName, locale });
  };

  return (
    <div className="settings">
      <h1>{copy.authAccount}</h1>
      <section>
        <h2>{copy.authProfile}</h2>
        <form
          onSubmit={(event) => {
            save(event);
          }}
        >
          <label>
            {copy.authDisplayName}
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            {copy.authLanguage}
            <select
              value={locale}
              onChange={(event) => {
                const next = event.target.value;

                setLocale(isLocale(next) ? next : "en");
              }}
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </label>
          <button type="submit" disabled={saveProfile.isPending}>
            {copy.authSave}
          </button>
          {saveProfile.isSuccess ? <output>{copy.authSaved}</output> : null}
        </form>
      </section>
      <section>
        <h2>{copy.authLinked}</h2>
        <ul>
          {accounts.map((entry) => (
            <li key={entry.accountId}>
              {entry.providerId}
              <button
                type="button"
                disabled={unlink.isPending}
                onClick={() => {
                  unlink.mutate(entry.accountId);
                }}
              >
                {copy.authUnlink}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <button
          type="button"
          onClick={() => {
            void signOutFn().finally(() => {
              window.location.assign("/");
            });
          }}
        >
          {copy.authSignOut}
        </button>
      </section>
    </div>
  );
}
