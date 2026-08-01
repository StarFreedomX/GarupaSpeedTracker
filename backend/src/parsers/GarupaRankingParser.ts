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
/**
 * Resolves the player's displayed card ID and training status from ranking data.
 *
 * The game has two profile-display modes controlled by
 * {@code UserProfileSituation.viewProfileSituationStatus}:
 * - {@code "profile_situation"} → show the user-selected profile card
 * - {@code "deck_leader"} (or empty/missing) → show the main deck's leader card
 *
 * This mirrors the game client's {@code UserProfileSituationModel.ViewProfileSituationType}
 * / {@code IllustThumbnailUtility.LoadProfileIllustCardThumbnail} logic.
 *
 * @param profileSituation - The player's profile situation (may be empty or missing)
 * @param deckLeaderId     - The deck leader card ID from {@code UserDeck.leader}
 * @param situationEntries - All cards in the player's deck
 * @returns Resolved {@code [sid, strained]} tuple
 */
const resolveDisplayCard = (
    profileSituation: GarupaRankingUser["userProfileSituation"],
    deckLeaderId: number | undefined,
    situationEntries: Array<{ situationId?: number; illust?: string }> | undefined,
): [sid: number, strained: number] => {
    const viewStatus = profileSituation?.viewProfileSituationStatus;

    // Profile-situation mode: use the explicitly selected card
    if (viewStatus === "profile_situation") {
        return [toNumber(profileSituation?.situationId), profileSituation?.illust === "after_training" ? 1 : 0];
    }

    // Deck-leader mode (or empty/missing profile situation): use deck leader
    if (typeof deckLeaderId === "number" && Number.isFinite(deckLeaderId) && deckLeaderId > 0) {
        const leaderCard = situationEntries?.find((entry) => entry.situationId === deckLeaderId);
        return [deckLeaderId, leaderCard?.illust === "after_training" ? 1 : 0];
    }

    return [1, 0];
};

/**
 * Converts a raw Garupa ranking user into a normalized {@link RankingUserRaw} record.
 *
 * @param user - The protobuf-decoded ranking user to normalize.
 * @returns A normalized user record with coerced numeric fields, string defaults, and extracted degrees.
 */
export const parseUser = (user: GarupaRankingUser): RankingUserRaw => {
    const [sid, strained] = resolveDisplayCard(user.userProfileSituation, user.userDeck?.leader, user.userSituationList?.entries);

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
