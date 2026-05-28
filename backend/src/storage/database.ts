export type DatabaseFilter = Record<string, unknown>;
export type DatabaseSort = Record<string, 1 | -1>;
export type DatabaseProjection<TDocument> = Partial<Record<keyof TDocument, 0 | 1>>;

export interface DatabaseFindQuery<TDocument> {
    project<TProjection extends Record<string, unknown>>(projection: DatabaseProjection<TDocument>): DatabaseFindQuery<TProjection>;
    sort(sort: DatabaseSort): DatabaseFindQuery<TDocument>;
    toArray(): Promise<TDocument[]>;
    first(): Promise<TDocument | undefined>;
}

export interface DatabaseCollection<TDocument> {
    findOne(filter: DatabaseFilter): Promise<TDocument | undefined>;
    replaceOne(filter: DatabaseFilter, document: TDocument, options?: { upsert?: boolean }): Promise<void>;
    updateOne(filter: DatabaseFilter, update: DatabaseUpdate, options?: { upsert?: boolean }): Promise<void>;
    find(filter: DatabaseFilter): Promise<DatabaseFindQuery<TDocument>>;
}

export interface Database {
    collection<TDocument = Record<string, unknown>>(name: string): DatabaseCollection<TDocument>;
    close(): Promise<void>;
}

export type DatabaseUpdate = Record<string, unknown> | Array<Record<string, unknown>>;
