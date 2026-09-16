import type { SchemaDefinition } from "./schemaDefinition";

/** 游戏登录前所需的客户端、数据和主数据版本信息。 / Version metadata required before game login. */
export interface GarupaApplicationResponse {
    clientVersion: string;
    dataVersion: string;
    masterDataVersion: string;
}

export const applicationResponseSchema: SchemaDefinition = {
    1: { name: "clientVersion", type: "string" },
    2: { name: "dataVersion", type: "string" },
    10: { name: "masterDataVersion", type: "string" },
};

/** 游戏登录响应返回的用户 ID。 / Game user ID returned by login. */
export interface GarupaLoginResponse {
    userId: number;
}

export const loginResponseSchema: SchemaDefinition = {
    1: { name: "userId", type: "long" },
};
