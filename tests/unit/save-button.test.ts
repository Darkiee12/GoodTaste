import { describe, expect, test } from "bun:test";

import {
  initialSaveButtonState,
  saveButtonTransition,
  type SaveButtonState,
} from "@/modules/user/components/save-dish-button";

const state = (overrides: Partial<SaveButtonState>): SaveButtonState => ({
  ...initialSaveButtonState,
  ...overrides,
});

describe("save button state machine", () => {
  test("reload adopts the server-confirmed value", () => {
    expect(saveButtonTransition(state({}), { type: "resolved", saved: true })).toEqual({
      confirmed: true,
      pending: null,
      failedAction: null,
    });

    expect(saveButtonTransition(state({}), { type: "resolved", saved: false })).toEqual({
      confirmed: false,
      pending: null,
      failedAction: null,
    });
  });

  test("in-flight server values never clobber a pending action", () => {
    const pending = state({ confirmed: false, pending: "save" });

    expect(saveButtonTransition(pending, { type: "resolved", saved: false })).toBe(pending);
  });

  test("duplicate requests while pending are ignored", () => {
    const pending = state({ confirmed: true, pending: "unsave" });

    expect(saveButtonTransition(pending, { type: "unsave-requested" })).toBe(pending);
    expect(saveButtonTransition(pending, { type: "save-requested" })).toBe(pending);
  });

  test("failed removal keeps the saved state so retry removes again", () => {
    const saved = state({ confirmed: true });

    const failed = saveButtonTransition(saved, { type: "unsave-requested" });
    expect(failed.pending).toBe("unsave");

    const errored = saveButtonTransition(failed, { type: "unsave-failed" });
    expect(errored).toEqual({ confirmed: true, pending: null, failedAction: "unsave" });

    // Retry must attempt removal again, not a save.
    const retried = saveButtonTransition(errored, { type: "unsave-requested" });
    expect(retried.pending).toBe("unsave");
    expect(retried.confirmed).toBe(true);
  });

  test("failed save keeps the unsaved state so retry saves again", () => {
    const unsaved = state({ confirmed: false });

    const failed = saveButtonTransition(unsaved, { type: "save-requested" });
    const errored = saveButtonTransition(failed, { type: "save-failed" });

    expect(errored).toEqual({ confirmed: false, pending: null, failedAction: "save" });

    const retried = saveButtonTransition(errored, { type: "save-requested" });
    expect(retried.pending).toBe("save");
  });

  test("success clears the failure and records the confirmed value", () => {
    const errored = state({ confirmed: true, failedAction: "unsave" });

    expect(saveButtonTransition(errored, { type: "unsave-succeeded" })).toEqual({
      confirmed: false,
      pending: null,
      failedAction: null,
    });
  });

  test("already-saved dishes ignore further save requests", () => {
    const saved = state({ confirmed: true });

    expect(saveButtonTransition(saved, { type: "save-requested" })).toBe(saved);
  });
});
