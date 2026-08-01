import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaRankingUser } from "@/types/garupaSchema";
import type { RankingUserRaw } from "@/types/rankingUser";

/**
 * Shared ranking user parsing utilities for Garupa ranking parsers.
 *
 * Provides safe number coercion, degree extraction, user normalization,
 * and bulk user conversion from protobuf-decoded ranking response containers.
 * A single {@link GarupaParser} instance is shared across all parsers.
 *
 * @module GarupaRankingParser
 */

/** Singleton {@link GarupaParser} instance shared by all ranking parsers. */
export const garupaParser = new GarupaParser();

/**
 * Coerces a value to a safe number.
 *
 * @param value - The value to coerce.
 * @returns The value if it is a finite number, otherwise `0`.
 */
export const toNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Extracts degree IDs from a ranking user's profile degree map.
 *
 * @param user - The ranking user containing `userProfileDegreeMap`.
 * @returns An array of finite numeric degree IDs, filtering out any non-finite values.
 */
export const buildDegrees = (user: GarupaRankingUser): number[] => {
    const entries = user.userProfileDegreeMap?.entries ?? [];
    return entries.map((entry) => toNumber(entry.value?.degreeId)).filter((value) => Number.isFinite(value));
};

/**
 * Converts a raw Garupa ranking user into a normalized {@link RankingUserRaw} record.
 *
 * @param user - The protobuf-decoded ranking user to normalize.
 * @returns A normalized user record with coerced numeric fields, string defaults, and extracted degrees.
 */
export const parseUser = (user: GarupaRankingUser): RankingUserRaw => {
    const profileSituation = user.userProfileSituation;
    let sid = toNumber(profileSituation?.situationId);
    let strained = profileSituation?.illust === "after_training" ? 1 : 0;

    // Fallback: when profile card is not set, use deck leader card
    if (sid === 0) {
        const leaderId = user.userDeck?.leader;
        if (typeof leaderId === "number" && Number.isFinite(leaderId) && leaderId > 0) {
            sid = leaderId;
            const leaderCard = user.userSituationList?.entries?.find((entry) => entry.situationId === leaderId);
            strained = leaderCard?.illust === "after_training" ? 1 : 0;
        }
    }

    return {
        uid: toNumber(user.userId),
        name: user.name ?? "",
        introduction: user.introduction ?? "",
        rank: toNumber(user.rankLevel),
        sid,
        strained,
        degrees: buildDegrees(user),
        tier: toNumber(user.rank),
        point: toNumber(user.point),
    };
};

/**
 * Converts a ranking response container (with optional `entries` array) into an array of normalized users.
 *
 * @param container - A ranking response container, typically `{ entries?: GarupaRankingUser[] }`.
 * @returns An array of {@link RankingUserRaw} records.
 */
export const buildUsers = (container?: { entries?: GarupaRankingUser[] }): RankingUserRaw[] => {
    const rows = container?.entries ?? [];
    return rows.map((user) => parseUser(user));
};
