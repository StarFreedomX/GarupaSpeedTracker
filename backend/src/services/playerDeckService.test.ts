import {
    fetchBestdoriAreaItems,
    fetchBestdoriCardsBulk,
    fetchBestdoriCharacters,
    fetchBestdoriEventsFull,
    fetchBestdoriPlayer,
    fetchBestdoriSkills,
} from "@/api/bestdori";
import { playerDeckService } from "@/services/playerDeckService";

jest.mock("@/api/bestdori", () => ({
    fetchBestdoriAreaItems: jest.fn(),
    fetchBestdoriCardsBulk: jest.fn(),
    fetchBestdoriCharacters: jest.fn(),
    fetchBestdoriEventsFull: jest.fn(),
    fetchBestdoriPlayer: jest.fn(),
    fetchBestdoriSkills: jest.fn(),
}));

const situationIds = [1476, 2146, 2514, 1718, 1780];
const characterIds = [21, 22, 23, 24, 25];

const event342 = {
    eventType: "challenge",
    eventName: ["未来想送曲"],
    characters: characterIds.map((characterId) => ({ characterId, percent: 20 })),
    attributes: [{ attribute: "happy", percent: 10 }],
    eventAttributeAndCharacterBonus: { pointPercent: 20, parameterPercent: 20 },
    eventCharacterParameterBonus: { performance: 50, technique: 0, visual: 0 },
    members: [{ situationId: 2514, percent: 20 }],
    limitBreaks: [{ rarity: 5, rank: 4, percent: 15 }],
};

const cards = Object.fromEntries(
    situationIds.map((situationId, index) => [
        String(situationId),
        {
            characterId: characterIds[index],
            attribute: "happy",
            rarity: 5,
            skillId: 0,
            stat: { "1": { performance: 1, technique: 1, visual: 1 } },
        },
    ]),
);

const player = {
    result: true,
    data: {
        profile: {
            publishTotalDeckPowerFlg: true,
            mainDeckUserSituations: {
                entries: situationIds.map((situationId) => ({
                    situationId,
                    level: 1,
                    limitBreakRank: 4,
                    skillLevel: 1,
                    userAppendParameter: {},
                })),
            },
            enabledUserAreaItems: { entries: [] },
        },
    },
};

beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(fetchBestdoriEventsFull).mockResolvedValue({ "342": event342 });
    jest.mocked(fetchBestdoriPlayer).mockResolvedValue(player);
    jest.mocked(fetchBestdoriCardsBulk).mockResolvedValue(cards);
    jest.mocked(fetchBestdoriAreaItems).mockResolvedValue({});
    jest.mocked(fetchBestdoriCharacters).mockResolvedValue(Object.fromEntries(characterIds.map((id) => [String(id), { bandId: 5 }])));
    jest.mocked(fetchBestdoriSkills).mockResolvedValue({});
});

it("does not count parameter bonus as challenge-live point bonus", async () => {
    const result = await playerDeckService.getPlayerDeckStatus(0, 35792379, 342);

    // 4 * (20 character + 10 attribute + 20 double-match + 15 limit break)
    // + (the same 65 + 20 event-member bonus) = 345%.
    expect(result.eventBonusPct).toBe(345);
    expect(result.autoPower).toBe(result.normalPower);
    expect(result.eventPower).toBeGreaterThan(result.normalPower);
});
