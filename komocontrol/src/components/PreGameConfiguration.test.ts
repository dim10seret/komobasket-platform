import { describe, expect, it } from "vitest";
import { savedDraftConfirmationVisible } from "./PreGameConfiguration";

describe("KC-5B9A Save Draft feedback", () => {
    it("shows confirmation only for the clean revision returned by a successful Save", () => {
        expect(savedDraftConfirmationVisible(2, 2, false)).toBe(true);
        expect(savedDraftConfirmationVisible(2, 2, true)).toBe(false);
        expect(savedDraftConfirmationVisible(2, 1, false)).toBe(false);
        expect(savedDraftConfirmationVisible(2, null, false)).toBe(false);
    });
});
