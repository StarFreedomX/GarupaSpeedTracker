import { type GarupaRankingUserList, rankingUserListSchema } from "@/types/garupaSchema/rankingUserSchema";
import type { SchemaDefinition } from "./schemaDefinition";

// ==========================================
//  顶层根响应 Schema
// ==========================================
export const userMonthlyRankingRankingResponseSchema: SchemaDefinition = {
    1: { name: "monthlyRankingPointNearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "monthlyRankingPointTopUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "monthlyRankingPointBorderUsers", type: "message", schema: rankingUserListSchema },
};

export interface GarupaMonthlyRankingRankingResponse {
    monthlyRankingPointNearUsers?: GarupaRankingUserList;
    monthlyRankingPointTopUsers?: GarupaRankingUserList;
    monthlyRankingPointBorderUsers?: GarupaRankingUserList;
}
