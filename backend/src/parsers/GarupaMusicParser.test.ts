import { parseGarupaMusic } from "@/parsers/GarupaMusicParser";

// Small protobuf fixture using the JP protocol's actual field numbers.
function varint(value: number): Buffer {
    const bytes: number[] = [];
    do {
        const next = value % 128;
        value = Math.floor(value / 128);
        bytes.push(next | (value ? 128 : 0));
    } while (value);
    return Buffer.from(bytes);
}
function field(id: number, value: number | string | Buffer): Buffer {
    if (typeof value === "number") return Buffer.concat([varint(id * 8), varint(value)]);
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    return Buffer.concat([varint(id * 8 + 2), varint(bytes.length), bytes]);
}
function fixture(scoreLevel?: number, title = "Game Changer"): Buffer {
    const song = Buffer.concat([field(1, 782), field(2, title), field(7, "normal"), field(11, 1), field(16, 1774177200000), field(17, 4122068400000)]);
    const diffs = ["easy", "normal", "hard", "expert", "special"].map((name, index) =>
        field(
            1,
            Buffer.concat([
                field(1, 782),
                field(2, name),
                field(3, [12, 16, 25, 29, 30][index]),
                field(11, 1774177200000),
                ...(index === 3 && scoreLevel !== undefined ? [field(13, scoreLevel)] : []),
            ]),
        ),
    );
    return Buffer.concat([field(1, field(1, song)), field(2, Buffer.concat(diffs))]);
}

test("reads scoreLevel field 13 independently from the displayed level", () => {
    const song = parseGarupaMusic(fixture(28))["782"];
    expect(song.musicTitle).toEqual(["Game Changer", null, null, null, null]);
    expect(song.publishedAt).toEqual(["1774177200000", null, null, null, null]);
    expect(song.closedAt).toEqual(["4122068400000", null, null, null, null]);
    for (const difficulty of Object.values(song.difficulty)) {
        expect(difficulty.publishedAt).toEqual(["1774177200000", null, null, null, null]);
    }
    expect(Object.keys(song.difficulty)).toEqual(["0", "1", "2", "3", "4"]);
    expect(song.difficulty["3"]).toMatchObject({ playLevel: 29, scoreLevel: 28 });
    expect(song.difficulty["0"]).toMatchObject({ playLevel: 12, scoreLevel: 12 });
    expect(song.difficulty["1"]).toMatchObject({ playLevel: 16, scoreLevel: 16 });
    expect(song.difficulty["2"]).toMatchObject({ playLevel: 25, scoreLevel: 25 });
    expect(song.difficulty["4"]).toMatchObject({ playLevel: 30, scoreLevel: 30 });
});

test("normalizes the JP FULL title prefix", () => {
    expect(parseGarupaMusic(fixture(undefined, "甅二重の虹(ダブル レインボウ)"))["782"].musicTitle[0]).toBe("[FULL]二重の虹(ダブル レインボウ)");
});

test("normalizes the JP original-song title prefix", () => {
    expect(parseGarupaMusic(fixture(undefined, "躄final phase"))["782"].musicTitle[0]).toBe("[原曲]final phase");
});

test.each([undefined, 0])("uses playLevel for an unset protobuf scoreLevel (%s)", (value) => {
    expect(parseGarupaMusic(fixture(value))["782"].difficulty["3"].scoreLevel).toBe(29);
});

test("rejects responses without both master lists", () => {
    expect(() => parseGarupaMusic(Buffer.alloc(0))).toThrow("empty or invalid");
});
