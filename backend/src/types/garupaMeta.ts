export interface GarupaMetaDocument {
    server: number;
    clientVersion: string;
    updatedAt: number;
    /** Optional type discriminator for non-version records (e.g. migration markers). */
    type?: string;
    /** Optional key for typed records. */
    key?: string;
}
