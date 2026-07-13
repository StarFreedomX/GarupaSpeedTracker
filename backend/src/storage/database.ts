/**
 * Generic filter used in database queries (e.g. `{ server: 0, eventId: 123 }`).
 */
export type DatabaseFilter = Record<string, unknown>;

/**
 * Sort specification: keys map to field names, values to `1` (ascending) or `-1` (descending).
 */
export type DatabaseSort = Record<string, 1 | -1>;

/**
 * Projection (field inclusion/exclusion) for query results.
 *
 * Keys are document field names; values are `1` (include) or `0` (exclude).
 * The special `_id` field can be included/excluded independently.
 */
export type DatabaseProjection<TDocument> = Partial<Record<keyof TDocument, 0 | 1>> & { _id?: 0 | 1 };

/**
 * A fluent query builder returned by {@link DatabaseCollection.find}.
 *
 * Supports chaining projection and sort before executing the query with
 * {@link toArray} or {@link first}.
 */
export interface DatabaseFindQuery<TDocument> {
    project<TProjection extends Record<string, unknown>>(projection: DatabaseProjection<TDocument>): DatabaseFindQuery<TProjection>;
    sort(sort: DatabaseSort): DatabaseFindQuery<TDocument>;
    toArray(): Promise<TDocument[]>;
    first(): Promise<TDocument | undefined>;
}

/**
 * Represents a single collection in the database.
 *
 * Provides CRUD-like operations abstracted behind a generic interface
 * so adapters (e.g. MongoDB, in-memory) can be swapped without changing
 * the rest of the codebase.
 */
export interface DatabaseCollection<TDocument> {
    findOne(filter: DatabaseFilter, options?: { projection?: DatabaseProjection<TDocument> }): Promise<TDocument | undefined>;
    replaceOne(filter: DatabaseFilter, document: TDocument, options?: { upsert?: boolean }): Promise<void>;
    updateOne(filter: DatabaseFilter, update: DatabaseUpdate, options?: { upsert?: boolean }): Promise<void>;
    find(filter: DatabaseFilter): Promise<DatabaseFindQuery<TDocument>>;
}

/**
 * Database abstraction layer.
 *
 * All service-layer code accesses data through this interface so the underlying
 * storage engine can be substituted. The current implementation is MongoDB-backed
 * (see `storage/dataBaseAdapter/mongodb.ts`).
 */
export interface Database {
    collection<TDocument = Record<string, unknown>>(name: string): DatabaseCollection<TDocument>;
    renameCollection(oldName: string, newName: string): Promise<void>;
    listCollectionNames(): Promise<string[]>;
    close(): Promise<void>;
}

/**
 * Update document shape: either a raw update operator object or an aggregation pipeline.
 */
export type DatabaseUpdate = Record<string, unknown> | Array<Record<string, unknown>>;
