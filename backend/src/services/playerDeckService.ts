import {
    fetchBestdoriAreaItems,
    fetchBestdoriCardsBulk,
    fetchBestdoriCharacters,
    fetchBestdoriEventsFull,
    fetchBestdoriPlayer,
    fetchBestdoriSkills,
} from "@/api/bestdori";
import type { AreaItemMeta } from "@/types/bestdori/area-item-meta";
import { calcAreaItemBonus, getBandId, setBandIdMap } from "@/types/bestdori/area-item-meta";
import type { BestdoriEventFullRaw } from "@/types/bestdori/event";
import type { Stat } from "@/types/bestdori/stat";
import { addStat, emptyStat, statTotal } from "@/types/bestdori/stat";

// ============================================================================
// Types
// ============================================================================

/** Describes a card's skill effect including bonus percentage and duration. */
interface CardSkillInfo {
    bonusPercent: number;
    durationSeconds: number;
    /** Progressive skill info if applicable (step rate and max cap). */
    progressive: { stepRate: number; maxCap: number } | null;
}

/** Full deck status returned to the client. */
export interface PlayerDeckStatusResult {
    eventType: string;
    eventName: string;
    eventId: number | null;
    /** Whether the player allows their total deck power to be published. */
    publishTotalDeckPowerFlg: boolean;
    /** Base deck power without event bonuses. */
    normalPower: number;
    /** Deck power including event bonuses. */
    eventPower: number;
    /** Auto-live deck power. */
    autoPower: number;
    /** Total event bonus percentage. */
    eventBonusPct: number;
    /** Skill info for each card in UI display order. */
    skills: CardSkillInfo[];
}

// ============================================================================
// Hard-coded data
// ============================================================================

const SERVER_NAMES = ["jp", "en", "tw", "cn", "kr"] as const;

/** Maps skill IDs to their progressive stat definitions (step rate, max cap). */
const PROGRESSIVE_MAP: Record<number, { stepRate: number; maxCap: number }> = {
    61: { stepRate: 0.5, maxCap: 150 },
};

// ============================================================================
// Bulk data loading (with fallback on cache miss)
// ============================================================================

type CardBulkMap = Record<string, Record<string, unknown>>;
type SkillBulkMap = Record<string, Record<string, unknown>>;

/**
 * Loads the card bulk cache, falling back to a force-update fetch if any of
 * the requested card IDs are missing from the cached dataset.
 *
 * @param cardIds - The set of card IDs needed.
 * @returns The card bulk map (from cache or fresh fetch).
 */
async function loadCardsWithFallback(cardIds: number[]): Promise<CardBulkMap> {
    // Try cache first
    let cards = await fetchBestdoriCardsBulk();
    const missing = cardIds.filter((id) => !cards[String(id)]);

    if (missing.length > 0) {
        // Force re-fetch to populate missing entries
        cards = await fetchBestdoriCardsBulk({ forceUpdate: true });
    }

    return cards;
}

/**
 * Loads the skill bulk cache, falling back to a force-update fetch if any of
 * the requested skill IDs are missing from the cached dataset.
 *
 * @param skillIds - The set of skill IDs needed.
 * @returns The skill bulk map (from cache or fresh fetch).
 */
async function loadSkillsWithFallback(skillIds: number[]): Promise<SkillBulkMap> {
    let skills = await fetchBestdoriSkills();
    const missing = skillIds.filter((id) => !skills[String(id)]);

    if (missing.length > 0) {
        skills = await fetchBestdoriSkills({ forceUpdate: true });
    }

    return skills;
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Scales each stat dimension by the given percentage.
 *
 * @param stat - The base stat values.
 * @param percent - The percentage to apply.
 * @returns A new stat with all three dimensions scaled.
 */
function scalePct(stat: Stat, percent: number): Stat {
    return { performance: (stat.performance * percent) / 100, technique: (stat.technique * percent) / 100, visual: (stat.visual * percent) / 100 };
}

/**
 * Safely retrieves an element from a nullable array at the given index.
 *
 * @param arr - The array (may contain nulls).
 * @param index - The index to retrieve.
 * @returns The value at the index, or null if out of bounds or undefined.
 */
function getAtIndex(arr: (number | null)[], index: number): number | null {
    return arr[index] ?? null;
}

// ============================================================================
// Base stat calculation
// ============================================================================

/**
 * Computes the base (unbuffed) stat of a card at a given level, including
 * any user-appended parameters (potential, character bonuses).
 *
 * @param cardStatRaw - The raw card stat data from Bestdori.
 * @param entry - The player's card entry with level and optional append parameters.
 * @returns The base stat.
 */
function calcBaseStat(cardStatRaw: Record<string, unknown>, entry: { level: number; userAppendParameter?: Record<string, number> }): Stat {
    const stat = cardStatRaw.stat as Record<string, { performance: number; technique: number; visual: number }> | undefined;
    const base = stat?.[String(entry.level)];
    if (!base) return emptyStat();
    const ap = entry.userAppendParameter ?? {};
    return {
        performance: base.performance + (ap.performance ?? 0) + (ap.characterPotentialPerformance ?? 0) + (ap.characterBonusPerformance ?? 0),
        technique: base.technique + (ap.technique ?? 0) + (ap.characterPotentialTechnique ?? 0) + (ap.characterBonusTechnique ?? 0),
        visual: base.visual + (ap.visual ?? 0) + (ap.characterPotentialVisual ?? 0) + (ap.characterBonusVisual ?? 0),
    };
}

// ============================================================================
// Event bonus calculation
// ============================================================================

/**
 * Calculates the event power bonus for a single card based on the active event.
 *
 * Considers character match, attribute match, member bonuses, limit break
 * bonuses, and character+attribute double bonuses (including parameter bonuses
 * for applicable event types).
 *
 * @param baseStat - The card's base stat.
 * @param chId - The card's character ID.
 * @param attr - The card's attribute.
 * @param cardId - The card's situation ID.
 * @param rarity - The card's rarity.
 * @param lbRank - The card's limit break rank.
 * @param event - The active event definition from Bestdori.
 * @returns The total event bonus stat for this card.
 */
function calcCardEventBonus(baseStat: Stat, chId: number, attr: string, cardId: number, rarity: number, lbRank: number, event: BestdoriEventFullRaw): Stat {
    const bonus = emptyStat();
    const charMatch = event.characters.some((c) => c.characterId === chId);
    const attrMatch = event.attributes.some((a) => a.attribute === attr);
    const memberMatch = event.members.some((m) => m.situationId === cardId);

    for (const c of event.characters) {
        if (c.characterId === chId) {
            addStat(bonus, scalePct(baseStat, c.percent));
            break;
        }
    }
    for (const a of event.attributes) {
        if (a.attribute === attr) {
            addStat(bonus, scalePct(baseStat, a.percent));
            break;
        }
    }
    const doubleBonus = event.eventAttributeAndCharacterBonus?.parameterPercent ?? 0;
    if (charMatch && attrMatch && doubleBonus) addStat(bonus, scalePct(baseStat, doubleBonus));
    if (memberMatch) {
        const m = event.members.find((x) => x.situationId === cardId);
        if (m) addStat(bonus, scalePct(baseStat, m.percent));
    }
    const lb = event.limitBreaks.find((l) => l.rarity === rarity && l.rank === lbRank);
    if (lb?.percent) addStat(bonus, scalePct(baseStat, lb.percent));
    if (charMatch && attrMatch && event.eventCharacterParameterBonus) {
        const pb = event.eventCharacterParameterBonus;
        if (pb.performance) bonus.performance += (baseStat.performance * pb.performance) / 100;
        if (pb.technique) bonus.technique += (baseStat.technique * pb.technique) / 100;
        if (pb.visual) bonus.visual += (baseStat.visual * pb.visual) / 100;
    }
    return bonus;
}

/**
 * Calculates the total event bonus percentage for a single card.
 *
 * The bonus percentage is derived from character match, attribute match,
 * member bonuses, limit break bonuses, and the doubled character+attribute
 * bonus. For "versus", "festival", and "medley" event types, the double bonus
 * uses `parameterPercent`; for other types it uses `pointPercent`.
 *
 * @param chId - The card's character ID.
 * @param attr - The card's attribute.
 * @param cardId - The card's situation ID.
 * @param rarity - The card's rarity.
 * @param lbRank - The card's limit break rank.
 * @param event - The active event definition.
 * @returns The total bonus percentage and whether both character and attribute match.
 */
function calcCardBonusPct(
    chId: number,
    attr: string,
    cardId: number,
    rarity: number,
    lbRank: number,
    event: BestdoriEventFullRaw,
): { totalPct: number; hasCharAttr: boolean } {
    let pct = 0;
    let hasChar = false;
    let hasAttr = false;
    for (const c of event.characters) {
        if (c.characterId === chId) {
            pct += c.percent;
            hasChar = true;
            break;
        }
    }
    for (const a of event.attributes) {
        if (a.attribute === attr) {
            pct += a.percent;
            hasAttr = true;
            break;
        }
    }
    const isEventPowerType = event.eventType === "versus" || event.eventType === "festival" || event.eventType === "medley";
    const doublePct = isEventPowerType
        ? (event.eventAttributeAndCharacterBonus?.parameterPercent ?? 0)
        : (event.eventAttributeAndCharacterBonus?.pointPercent ?? 0);
    if (hasChar && hasAttr && doublePct) pct += doublePct;
    if (event.members.some((m) => m.situationId === cardId)) {
        const m = event.members.find((x) => x.situationId === cardId);
        if (m) pct += m.percent;
    }
    const lb = event.limitBreaks.find((l) => l.rarity === rarity && l.rank === lbRank);
    if (lb?.percent) pct += lb.percent;
    return { totalPct: pct, hasCharAttr: hasChar && hasAttr };
}

// ============================================================================
// Skill calculation
// ============================================================================

/** Minimal card summary used for skill unification condition checking. */
interface CardBrief {
    bandId: number;
    attribute: string;
}

/** Skill effect types that produce a scoring bonus. */
const SCORING_TYPES = ["score", "score_only_perfect", "score_over_life", "score_under_life", "score_continued_note_judge", "score_under_great_half"] as const;

/**
 * Returns true if the skill condition is a gameplay judgment condition
 * (PERFECT, GREAT, GOOD, BAD) that is considered always met.
 *
 * @param condition - The activation condition string.
 * @returns True if it is a gameplay judgment condition.
 */
function isGameplayCondition(condition: string): boolean {
    return condition === "perfect" || condition === "great" || condition === "good" || condition === "bad";
}

/**
 * Returns true if the skill has a life threshold condition that is considered met.
 *
 * @param conditionLife - The life threshold value.
 * @returns True if the threshold is positive.
 */
function isLifeCondition(conditionLife: number | undefined): boolean {
    return conditionLife != null && conditionLife > 0;
}

/**
 * Calculates the skill effect for a single card.
 *
 * Searches through all scoring effect types to find the highest applicable
 * bonus percentage. Skill unification effects (e.g. "all Poppin'Party cards")
 * are checked against the full team and override the base bonus if satisfied.
 *
 * @param card - The card's skill ID and level.
 * @param skillsRaw - The bulk skill data from Bestdori.
 * @param server - The server index.
 * @param allCards - Brief summaries of all cards in the team (for unification checks).
 * @returns The computed skill info including bonus percent and duration.
 */
function calcSkill(card: { skillId: number; skillLevel: number }, skillsRaw: SkillBulkMap, server: number, allCards: CardBrief[]): CardSkillInfo {
    const skill = skillsRaw[String(card.skillId)];
    if (!skill) return { bonusPercent: 0, durationSeconds: 0, progressive: null };

    const levelIndex = card.skillLevel - 1;
    const serverIndex = Math.min(server, 4);
    const ae = skill.activationEffect as Record<string, unknown> | undefined;
    const effectTypes = (ae?.activateEffectTypes ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const progressive = PROGRESSIVE_MAP[card.skillId] ?? null;

    // Iterate scoring effects, pick the highest bonus that is applicable.
    // Gameplay judgment conditions and life conditions are always assumed met.
    let bestBonus = 0;
    for (const type of SCORING_TYPES) {
        const eff = effectTypes[type];
        if (!eff) continue;

        const rawValue = getAtIndex(eff.activateEffectValue as (number | null)[], serverIndex);
        if (rawValue == null) continue;

        // Check if the activation condition is applicable
        const condition = (eff.activateCondition as string | undefined) ?? "good";
        const conditionLife = eff.activateConditionLife as number | undefined;
        const isApplicable = condition === "none" || isGameplayCondition(condition) || isLifeCondition(conditionLife);

        if (isApplicable && rawValue > bestBonus) {
            bestBonus = rawValue;
        }
    }

    // Unification bonus: higher bonus when the whole team satisfies a band or attribute condition.
    // Example: skill 74 gives 155% when the entire team is Poppin'Party, otherwise 145%.
    const unificationValue = ae?.unificationActivateEffectValue as number | undefined;
    if (unificationValue != null && unificationValue > bestBonus) {
        const bandId = ae?.unificationActivateConditionBandId as number | undefined;
        const attrType = ae?.unificationActivateConditionType as string | undefined;

        // Check conditions: bandId and attrType can be combined (both must match)
        let satisfied = bandId != null || attrType != null;
        if (bandId != null && !allCards.every((c) => c.bandId === bandId)) {
            satisfied = false;
        }
        if (attrType != null && !allCards.every((c) => c.attribute.toUpperCase() === attrType.toUpperCase())) {
            satisfied = false;
        }

        if (satisfied) {
            bestBonus = unificationValue;
        }
    }

    const durationArr = (skill.duration ?? []) as number[];
    const duration = getAtIndex(durationArr, levelIndex) ?? 0;

    return { bonusPercent: bestBonus, durationSeconds: duration, progressive };
}

// ============================================================================
// Main service
// ============================================================================

/**
 * Computes a player's deck status from Bestdori player data, including card
 * stats, area item bonuses, event bonuses, and skill effects.
 *
 * The service handles multi-event-type logic:
 * - "versus", "festival", "medley": event power includes event bonuses; auto power matches event power.
 * - "challenge": event power includes event bonuses; auto power uses base (normal) power.
 * - Other types: no event bonus applied to either power.
 *
 * Skill results are reordered to match the UI display order (member3 →
 * member1 → leader → member2 → member4).
 */
export const playerDeckService = {
    /**
     * Computes the full deck status for a given player on a given server.
     *
     * @param server - The server index (0 = JP, 1 = EN, etc.).
     * @param playerId - The player's Bestdori numeric ID.
     * @param eventId - Optional explicit event ID; if not provided, the current
     *   event is determined automatically.
     * @returns The deck status result including powers, bonus percentages, and skill info.
     * @throws If the player's deck is empty.
     */
    async getPlayerDeckStatus(server: number, playerId: number, eventId?: number | null): Promise<PlayerDeckStatusResult> {
        const serverName = SERVER_NAMES[server] ?? "jp";

        // Load base data in parallel
        const [eventsFull, playerApi] = await Promise.all([fetchBestdoriEventsFull(), fetchBestdoriPlayer(serverName, playerId)]);

        const profile = (playerApi.data?.profile ?? {}) as Record<string, unknown>;
        const publishTotalDeckPowerFlg = (profile.publishTotalDeckPowerFlg as boolean) ?? false;
        const entries = (profile.mainDeckUserSituations as { entries: Array<Record<string, unknown>> } | undefined)?.entries ?? [];
        const areaItemEntries = (profile.enabledUserAreaItems as { entries: Array<{ areaItemCategory: number; level: number }> } | undefined)?.entries ?? [];

        if (entries.length === 0) throw new Error("Player deck is empty");

        // Determine the active event
        const resolvedEventId = eventId && eventId > 0 ? eventId : getPresentEvent(eventsFull, server);
        const event = resolvedEventId ? eventsFull[String(resolvedEventId)] : null;

        // Collect card IDs and player card entries
        const cardIds: number[] = [];
        const playerCards: Array<{
            situationId: number;
            level: number;
            limitBreakRank: number;
            skillLevel: number;
            userAppendParameter?: Record<string, number>;
        }> = [];
        for (const entry of entries) {
            const sid = entry.situationId as number;
            cardIds.push(sid);
            playerCards.push({
                situationId: sid,
                level: entry.level as number,
                limitBreakRank: (entry.limitBreakRank as number) ?? 0,
                skillLevel: (entry.skillLevel as number) ?? 1,
                userAppendParameter: entry.userAppendParameter as Record<string, number> | undefined,
            });
        }

        // Bulk load cards, area items, characters in parallel
        const [cardsBulk, areaItemsRaw, charactersRaw] = await Promise.all([
            loadCardsWithFallback(cardIds),
            fetchBestdoriAreaItems(),
            fetchBestdoriCharacters(),
        ]);

        // Initialize character → band mapping
        setBandIdMap(charactersRaw);

        // Collect skill IDs, then bulk load skills
        const skillIds = cardIds
            .map((id) => {
                const c = cardsBulk[String(id)];
                return c ? (c.skillId as number) : 0;
            })
            .filter((s) => s > 0);
        const skillsRaw = await loadSkillsWithFallback(skillIds);

        // Build team-wide card briefs for skill unification checks
        const allCardBriefs: CardBrief[] = cardIds.map((id) => {
            const c = cardsBulk[String(id)];
            if (!c) return { bandId: 0, attribute: "" };
            const chId = c.characterId as number;
            return {
                bandId: getBandId(chId),
                attribute: (c.attribute as string) ?? "",
            };
        });

        // Build area item metadata map
        const areaItemMetaMap = new Map<number, AreaItemMeta>();
        for (const [catStr, raw] of Object.entries(areaItemsRaw)) {
            const r = raw as Record<string, unknown>;
            areaItemMetaMap.set(Number(catStr), {
                areaItemCategory: Number(catStr),
                targetAttributes: (r.targetAttributes ?? []) as AreaItemMeta["targetAttributes"],
                targetBandIds: (r.targetBandIds ?? []) as number[],
                performance: (r.performance ?? {}) as Record<string, Array<number | null>>,
                technique: (r.technique ?? {}) as Record<string, Array<number | null>>,
                visual: (r.visual ?? {}) as Record<string, Array<number | null>>,
            });
        }

        // Process each card
        let normalPower = 0;
        let eventPower = 0;
        let autoPower = 0;
        let totalBonusPct = 0;
        const skills: CardSkillInfo[] = [];

        for (const pc of playerCards) {
            const cardRaw = cardsBulk[String(pc.situationId)];
            if (!cardRaw) {
                // Card not found even after fallback — skip with empty skill
                skills.push({ bonusPercent: 0, durationSeconds: 0, progressive: null });
                continue;
            }

            const chId = cardRaw.characterId as number;
            const attr = cardRaw.attribute as string;
            const rarity = cardRaw.rarity as number;
            const bandId = getBandId(chId);

            const baseStat = calcBaseStat(cardRaw, pc);

            // Area item bonuses
            const areaBonus = emptyStat();
            for (const ai of areaItemEntries) {
                const am = areaItemMetaMap.get(ai.areaItemCategory);
                if (!am) continue;
                addStat(areaBonus, calcAreaItemBonus(am, ai.level, baseStat, attr as "cool" | "happy" | "pure" | "powerful", bandId, server));
            }

            const cardNormal = statTotal(baseStat) + statTotal(areaBonus);
            normalPower += cardNormal;

            // Event bonuses
            if (event) {
                const eventBonus = calcCardEventBonus(baseStat, chId, attr, pc.situationId, rarity, pc.limitBreakRank, event);
                const { totalPct, hasCharAttr } = calcCardBonusPct(chId, attr, pc.situationId, rarity, pc.limitBreakRank, event);
                const pbPct =
                    hasCharAttr && event.eventCharacterParameterBonus
                        ? (event.eventCharacterParameterBonus.performance ?? 0) +
                          (event.eventCharacterParameterBonus.technique ?? 0) +
                          (event.eventCharacterParameterBonus.visual ?? 0)
                        : 0;
                totalBonusPct += totalPct + pbPct;

                if (event.eventType === "versus" || event.eventType === "festival" || event.eventType === "medley") {
                    eventPower += cardNormal + statTotal(eventBonus);
                    autoPower = eventPower;
                } else if (event.eventType === "challenge") {
                    eventPower += cardNormal + statTotal(eventBonus);
                    autoPower += cardNormal;
                } else {
                    eventPower += cardNormal;
                    autoPower += cardNormal;
                }
            } else {
                eventPower += cardNormal;
                autoPower += cardNormal;
            }

            // Skill calculation
            skills.push(calcSkill({ skillId: cardRaw.skillId as number, skillLevel: pc.skillLevel }, skillsRaw, server, allCardBriefs));
        }

        if (!event && autoPower === 0) eventPower = normalPower;

        // Reorder skills for UI display: backend order is leader→member1-4,
        // frontend UI order top-to-bottom is member3→member1→leader→member2→member4
        const UI_SKILL_ORDER = [3, 1, 0, 2, 4];
        const reorderedSkills = skills.length === UI_SKILL_ORDER.length ? UI_SKILL_ORDER.map((i) => skills[i]) : skills;

        return {
            eventType: event?.eventType ?? "none",
            eventName: (event?.eventName?.[server] ?? event?.eventName?.[0] ?? "") as string,
            eventId: resolvedEventId,
            publishTotalDeckPowerFlg,
            normalPower: Math.floor(normalPower),
            eventPower: Math.floor(eventPower),
            autoPower: Math.floor(autoPower),
            eventBonusPct: Math.round(totalBonusPct),
            skills: reorderedSkills,
        };
    },
};

// ============================================================================
// getPresentEvent
// ============================================================================

/**
 * Finds the currently active (or soonest upcoming) event ID for a given server.
 *
 * An event is considered present if it is currently ongoing (now is between
 * `startAt - 1 day` and `endAt`). If no event is ongoing, the event whose
 * start time is closest to now is returned.
 *
 * @param events - The full event map from Bestdori.
 * @param server - The server index.
 * @param time - Optional reference timestamp (defaults to `Date.now()`).
 * @returns The event ID, or null if no events exist for the server.
 */
function getPresentEvent(events: Record<string, BestdoriEventFullRaw>, server: number, time?: number): number | null {
    const now = time ?? Date.now();
    const eventIds = Object.keys(events).map(Number);
    const ongoing = eventIds.filter((id) => {
        const e = events[String(id)];
        if (!e?.startAt?.[server] || !e?.endAt?.[server]) return false;
        const startAt = e.startAt[server];
        const endAt = e.endAt[server];
        if (startAt == null || endAt == null) return false;
        const start = new Date(Number(startAt)).getTime();
        const end = new Date(Number(endAt)).getTime();
        return start - 86400000 <= now && end >= now;
    });

    if (ongoing.length > 0) return ongoing.sort((a, b) => b - a)[ongoing.length - 1];

    const withStart = eventIds.filter((id) => events[String(id)]?.startAt?.[server] != null);
    if (withStart.length === 0) return null;

    withStart.sort((a, b) => {
        const saStr = events[String(a)]?.startAt?.[server];
        const sbStr = events[String(b)]?.startAt?.[server];
        const sa = saStr != null ? new Date(Number(saStr)).getTime() : 0;
        const sb = sbStr != null ? new Date(Number(sbStr)).getTime() : 0;
        return Math.abs(sa - now) - Math.abs(sb - now);
    });

    return withStart[0] ?? null;
}
