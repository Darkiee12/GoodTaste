import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  BookmarkIcon,
  ChevronDownIcon,
  CircleUserRound,
  LogOutIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutFn } from "@/modules/user/auth.functions";
import { clearFavoriteCaches } from "@/modules/user/components/save-dish-button";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

/**
 * Single account entry point in the site header. Guests find sign-in and
 * account creation here. Members get a small menu with exactly three tabs —
 * saved dishes, account, security — and nothing else: no personal details,
 * no admin links (Feast Lab lives in the navbar for those who hold it), no
 * sign-out (it lives on the account page next to the danger it guards).
 * Language lives in the standalone globe menu beside this button.
 */
export function AccountMenu() {
  const { lang } = rootRoute.useSearch();
  const { session } = rootRoute.useRouteContext();
  const copy = messagesFor(lang);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signedIn = session.status === "signed-in";

  const signOut = (): void => {
    void signOutFn().then(
      () => {
        clearFavoriteCaches(queryClient);
        void navigate({ to: "/", search: { lang } });
      },
      () => {
        void navigate({ to: "/", search: { lang } });
      },
    );
  };

  if (signedIn) {
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={copy.authAccount}
            title={copy.authAccount}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-transparent px-3 text-sm font-semibold text-muted-on-dark hover:border-white/25 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"
          >
            <CircleUserRound aria-hidden="true" className="size-5" />
            <span className="max-w-28 truncate">{session.user.name}</span>
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to="/saved" search={{ lang }}>
                <BookmarkIcon aria-hidden="true" className="size-4" />
                {copy.savedTitle}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings/account" search={{ lang }}>
                <UserRoundIcon aria-hidden="true" className="size-4" />
                {copy.authAccount}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings/security" search={{ lang }}>
                <ShieldCheckIcon aria-hidden="true" className="size-4" />
                {copy.authSecurity}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                signOut();
              }}
            >
              <LogOutIcon aria-hidden="true" className="size-4" />
              {copy.authSignOut}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={copy.accountMenu}
          title={copy.accountMenu}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-transparent px-3 text-sm font-semibold text-muted-on-dark hover:border-white/25 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"
        >
          <CircleUserRound aria-hidden="true" className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {session.status === "unavailable" ? (
          <>
            <DropdownMenuLabel>
              <span role="note" className="text-xs font-semibold">
                {copy.saveDishPaused}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/sign-in" search={{ lang, returnTo: "/" }}>
              {copy.authSignIn}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/sign-up" search={{ lang, returnTo: "/" }}>
              {copy.authSignUp}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
