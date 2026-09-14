import { loadRidState, saveRidState, type RidState } from "./garupaRidStore";
import type { DatabaseCollection } from "./database";

function memoryCollection() {
    const rows = new Map<number, RidState>();
    return {
        findOne: jest.fn(async ({ _id }) => rows.get(_id)),
        updateOne: jest.fn(async ({ _id }, update) => { rows.set(_id, { _id, ...update.$set }); }),
    } as unknown as DatabaseCollection<RidState>;
}

it("uses the environment fallback until a response nonce is saved and retains it on reload", async () => {
    const c = memoryCollection();
    expect(await loadRidState(c, 3, "initial")).toBe("initial");
    expect(c.updateOne).not.toHaveBeenCalled();
    await saveRidState(c, 3, "response");
    expect(await loadRidState(c, 3, "initial")).toBe("response");
});

it("allows direct manual replacement and keeps servers separate", async () => {
    const c = memoryCollection();
    await saveRidState(c, 0, "jp");
    await saveRidState(c, 3, "old");
    await saveRidState(c, 3, "manual");
    expect(await loadRidState(c, 3)).toBe("manual");
    expect(await loadRidState(c, 0)).toBe("jp");
});
