import type { SchemaDefinition } from "./schemaDefinition";

/** Version metadata required before game login. */
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

/** Game user ID returned by login. */
export interface GarupaLoginResponse {
    userId: number;
}

export const loginResponseSchema: SchemaDefinition = {
    1: { name: "userId", type: "long" },
};
