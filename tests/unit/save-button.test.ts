import { describe, expect, test } from "bun:test";

import {
  applyMembershipToIds,
  initialSaveButtonState,
  saveButtonTransition,
  type SaveButtonState,
} from "@/modules/user/components/save-dish-button";

const state = (overrides: Partial<SaveButtonState>): SaveButtonState => ({
  ...initialSaveButtonState,
  ...overrides,
});

const resolved = (owner: string, saved: boolean, updatedAt: number) =>
  saveButtonTransition(state({ owner, confirmed: undefined, updatedAt: 0 }), {
    type: "resolved",
    owner,
    saved,
    updatedAt,
  });

describe("save button state machine", () => {
  test("reload adopts the server-confirmed value for a new owner", () => {
    expect(
      saveButtonTransition(state({}), {
        type: "resolved",
        owner: "user-a",
        saved: true,
        updatedAt: 100,
      }),
    ).toEqual({
      owner: "user-a",
      confirmed: true,
      updatedAt: 100,
      pending: null,
      failedAction: null,
    });
  });

  test("account change resets confirmed state instead of leaking it", () => {
    const alice = state({ owner: "user-a", confirmed: true, updatedAt: 100 });

    const switched = saveButtonTransition(alice, { type: "identity-changed", owner: "user-b" });

    expect(switched).toEqual({
      owner: "user-b",
      confirmed: undefined,
      updatedAt: 0,
      pending: null,
      failedAction: null,
    });

    expect(
      saveButtonTransition(switched, {
        type: "resolved",
        owner: "user-b",
        saved: false,
        updatedAt: 50,
      }),
    ).toEqual({
      owner: "user-b",
      confirmed: false,
      updatedAt: 50,
      pending: null,
      failedAction: null,
    });
  });

  test("sign-out clears ownership so guests never see member state", () => {
    const signedIn = state({ owner: "user-a", confirmed: true, updatedAt: 100 });

    expect(saveButtonTransition(signedIn, { type: "identity-changed", owner: null })).toEqual(
      initialSaveButtonState,
    );
  });

  test("stale snapshots never overwrite a newer confirmed action", () => {
    const confirmed = state({ owner: "user-a", confirmed: false, updatedAt: 200 });

    expect(
      saveButtonTransition(confirmed, {
        type: "resolved",
        owner: "user-a",
        saved: true,
        updatedAt: 100,
      }),
    ).toBe(confirmed);
  });

  test("in-flight server values never clobber a pending action", () => {
    const pending = state({ owner: "user-a", confirmed: false, pending: "save", updatedAt: 200 });

    expect(
      saveButtonTransition(pending, {
        type: "resolved",
        owner: "user-a",
        saved: false,
        updatedAt: 300,
      }),
    ).toBe(pending);
  });

  test("duplicate requests while pending are ignored", () => {
    const pending = state({ owner: "user-a", confirmed: true, pending: "unsave", updatedAt: 100 });

    expect(saveButtonTransition(pending, { type: "unsave-requested" })).toBe(pending);
    expect(saveButtonTransition(pending, { type: "save-requested" })).toBe(pending);
  });

  test("failed removal keeps the saved state so retry removes again", () => {
    const saved = state({ owner: "user-a", confirmed: true, updatedAt: 100 });

    const failed = saveButtonTransition(saved, { type: "unsave-requested" });
    expect(failed.pending).toBe("unsave");

    const errored = saveButtonTransition(failed, { type: "unsave-failed" });
    expect(errored).toEqual({
      owner: "user-a",
      confirmed: true,
      updatedAt: 100,
      pending: null,
      failedAction: "unsave",
    });

    const retried = saveButtonTransition(errored, { type: "unsave-requested" });
    expect(retried.pending).toBe("unsave");
    expect(retried.confirmed).toBe(true);
  });

  test("failed save keeps the unsaved state so retry saves again", () => {
    const unsaved = state({ owner: "user-a", confirmed: false, updatedAt: 100 });

    const failed = saveButtonTransition(unsaved, { type: "save-requested" });
    const errored = saveButtonTransition(failed, { type: "save-failed" });

    expect(errored).toEqual({
      owner: "user-a",
      confirmed: false,
      updatedAt: 100,
      pending: null,
      failedAction: "save",
    });

    const retried = saveButtonTransition(errored, { type: "save-requested" });
    expect(retried.pending).toBe("save");
  });

  test("success clears the failure and records the confirmed value", () => {
    const errored = state({
      owner: "user-a",
      confirmed: true,
      updatedAt: 100,
      failedAction: "unsave",
    });

    expect(saveButtonTransition(errored, { type: "unsave-succeeded" })).toEqual({
      owner: "user-a",
      confirmed: false,
      updatedAt: 100,
      pending: null,
      failedAction: null,
    });
  });

  test("already-saved dishes ignore further save requests", () => {
    const saved = state({ owner: "user-a", confirmed: true, updatedAt: 100 });

    expect(saveButtonTransition(saved, { type: "save-requested" })).toBe(saved);
  });
});

describe("two mounted buttons sharing one dish", () => {
  test("the second button follows the first button's confirmed action", () => {
    // Both buttons hydrate from the same initial fetch (updatedAt 100).
    let buttonA = resolved("user-a", false, 100);
    let buttonB = resolved("user-a", false, 100);

    expect(buttonA.confirmed).toBe(false);
    expect(buttonB.confirmed).toBe(false);

    // Button A saves: reducer marks saved; the cache write + refetch produce
    // a newer snapshot (updatedAt 200) that both buttons observe.
    buttonA = saveButtonTransition(buttonA, { type: "save-requested" });
    buttonA = saveButtonTransition(buttonA, { type: "save-succeeded" });

    expect(buttonA.confirmed).toBe(true);

    const fresh = { type: "resolved", owner: "user-a", saved: true, updatedAt: 200 } as const;
    buttonB = saveButtonTransition(buttonB, fresh);

    expect(buttonB.confirmed).toBe(true);
    expect(buttonA.confirmed).toBe(buttonB.confirmed);
  });

  test("a stale snapshot arriving after the fresh one is ignored", () => {
    let buttonB = resolved("user-a", false, 100);

    buttonB = saveButtonTransition(buttonB, {
      type: "resolved",
      owner: "user-a",
      saved: true,
      updatedAt: 200,
    });

    expect(buttonB.confirmed).toBe(true);

    // Late duplicate of the pre-mutation fetch: older timestamp, old value.
    const stale = saveButtonTransition(buttonB, {
      type: "resolved",
      owner: "user-a",
      saved: false,
      updatedAt: 100,
    });

    expect(stale).toBe(buttonB);
    expect(stale.confirmed).toBe(true);
  });

  test("equal timestamps do not overwrite a newer confirmed action", () => {
    const confirmed = state({ owner: "user-a", confirmed: true, updatedAt: 200 });

    expect(
      saveButtonTransition(confirmed, {
        type: "resolved",
        owner: "user-a",
        saved: false,
        updatedAt: 200,
      }),
    ).toBe(confirmed);
  });
});

describe("favorite cache reconciliation", () => {
  test("confirmed saves add the id exactly once", () => {
    expect(applyMembershipToIds([], "7", true)).toEqual(["7"]);
    expect(applyMembershipToIds(["7"], "7", true)).toEqual(["7"]);
    expect(applyMembershipToIds(["7", "9"], "11", true)).toEqual(["7", "9", "11"]);
  });

  test("confirmed removals drop only the removed id", () => {
    expect(applyMembershipToIds(["7", "9"], "7", false)).toEqual(["9"]);
    expect(applyMembershipToIds(["9"], "7", false)).toEqual(["9"]);
    expect(applyMembershipToIds([], "7", false)).toEqual([]);
  });
});
