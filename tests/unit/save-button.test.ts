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

describe("save button state machine", () => {
  test("reload adopts the server-confirmed value for a new owner", () => {
    expect(
      saveButtonTransition(state({}), { type: "resolved", owner: "user-a", saved: true }),
    ).toEqual({ owner: "user-a", confirmed: true, pending: null, failedAction: null });
  });

  test("account change resets confirmed state instead of leaking it", () => {
    const alice = state({ owner: "user-a", confirmed: true });

    const switched = saveButtonTransition(alice, { type: "identity-changed", owner: "user-b" });

    expect(switched).toEqual({
      owner: "user-b",
      confirmed: undefined,
      pending: null,
      failedAction: null,
    });

    expect(
      saveButtonTransition(switched, { type: "resolved", owner: "user-b", saved: false }),
    ).toEqual({ owner: "user-b", confirmed: false, pending: null, failedAction: null });
  });

  test("sign-out clears ownership so guests never see member state", () => {
    const signedIn = state({ owner: "user-a", confirmed: true });

    expect(saveButtonTransition(signedIn, { type: "identity-changed", owner: null })).toEqual(
      initialSaveButtonState,
    );
  });

  test("stale snapshots never overwrite a newer confirmed action", () => {
    const confirmed = state({ owner: "user-a", confirmed: false });

    expect(
      saveButtonTransition(confirmed, { type: "resolved", owner: "user-a", saved: true }),
    ).toBe(confirmed);
  });

  test("in-flight server values never clobber a pending action", () => {
    const pending = state({ owner: "user-a", confirmed: false, pending: "save" });

    expect(saveButtonTransition(pending, { type: "resolved", owner: "user-a", saved: false })).toBe(
      pending,
    );
  });

  test("duplicate requests while pending are ignored", () => {
    const pending = state({ owner: "user-a", confirmed: true, pending: "unsave" });

    expect(saveButtonTransition(pending, { type: "unsave-requested" })).toBe(pending);
    expect(saveButtonTransition(pending, { type: "save-requested" })).toBe(pending);
  });

  test("failed removal keeps the saved state so retry removes again", () => {
    const saved = state({ owner: "user-a", confirmed: true });

    const failed = saveButtonTransition(saved, { type: "unsave-requested" });
    expect(failed.pending).toBe("unsave");

    const errored = saveButtonTransition(failed, { type: "unsave-failed" });
    expect(errored).toEqual({
      owner: "user-a",
      confirmed: true,
      pending: null,
      failedAction: "unsave",
    });

    const retried = saveButtonTransition(errored, { type: "unsave-requested" });
    expect(retried.pending).toBe("unsave");
    expect(retried.confirmed).toBe(true);
  });

  test("failed save keeps the unsaved state so retry saves again", () => {
    const unsaved = state({ owner: "user-a", confirmed: false });

    const failed = saveButtonTransition(unsaved, { type: "save-requested" });
    const errored = saveButtonTransition(failed, { type: "save-failed" });

    expect(errored).toEqual({
      owner: "user-a",
      confirmed: false,
      pending: null,
      failedAction: "save",
    });

    const retried = saveButtonTransition(errored, { type: "save-requested" });
    expect(retried.pending).toBe("save");
  });

  test("success clears the failure and records the confirmed value", () => {
    const errored = state({ owner: "user-a", confirmed: true, failedAction: "unsave" });

    expect(saveButtonTransition(errored, { type: "unsave-succeeded" })).toEqual({
      owner: "user-a",
      confirmed: false,
      pending: null,
      failedAction: null,
    });
  });

  test("already-saved dishes ignore further save requests", () => {
    const saved = state({ owner: "user-a", confirmed: true });

    expect(saveButtonTransition(saved, { type: "save-requested" })).toBe(saved);
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
