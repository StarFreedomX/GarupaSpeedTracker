import type { SchemaDefinition } from "@/types/garupaSchema/schemaDefinition";

interface ProtoFieldRaw {
    field: number;
    wireType: number;
    data: number | Buffer;
}

/**
 * A low-level protobuf decoder that reads wire-format binary data without requiring
 * precompiled `.proto` definitions. It parses raw tag/wire-type/length-value fields
 * from a Buffer and then maps them to typed JavaScript values according to a runtime
 * {@link SchemaDefinition}.
 *
 * **Decoding approach:**
 * 1. **Raw field parsing** (`parseRawFields`): Iterates through the buffer byte by byte,
 *    reading varint-encoded field keys and extracting wire-type-specific payloads
 *    (varint, length-delimited, 64-bit fixed, or 32-bit fixed).
 * 2. **Field grouping**: Groups raw fields by their protobuf field number.
 * 3. **Schema-driven conversion** (`decode`): For each field in the provided schema, the
 *    grouped raw fields are converted to the target type (`int`, `long`, `bool`, `string`,
 *    `bytes`, `double`, `float`, or nested `message`). Repeated fields produce arrays;
 *    non-repeated fields take the last valid occurrence (robust to trailing garbage).
 * 4. **Wire-type validation**: Each raw field's wire type is checked against the expected
 *    type; mismatches are silently skipped to tolerate malformed or extra data.
 */
export class GarupaParser {
    /**
     * Reads a protobuf varint from the buffer starting at the given offset.
     * Returns the decoded value and the new offset position.
     * @throws If the varint exceeds 56 bits or the buffer ends unexpectedly
     */
    private readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
        let value = 0;
        let shift = 0;
        let cursor = offset;

        while (cursor < buffer.length) {
            const byte = buffer[cursor++];
            value += (byte & 0x7f) * 2 ** shift;
            if ((byte & 0x80) === 0) {
                return { value, offset: cursor };
            }
            shift += 7;
            if (shift > 56) {
                throw new Error("Varint is too large");
            }
        }

        throw new Error("Unexpected end of buffer while reading varint");
    }

    /**
     * Parses the entire buffer into a flat list of raw protobuf fields.
     * Each entry contains the field number, wire type, and raw data (number for varint, Buffer for length-delimited/fixed).
     * A field key of zero or an unrecoverable parse error terminates the loop.
     */
    private parseRawFields(buffer: Buffer): ProtoFieldRaw[] {
        const results: ProtoFieldRaw[] = [];
        let offset = 0;

        while (offset < buffer.length) {
            let keyResult: { value: number; offset: number };
            try {
                keyResult = this.readVarint(buffer, offset);
            } catch {
                break;
            }

            const key = keyResult.value;
            offset = keyResult.offset;
            if (key === 0) {
                break;
            }

            const field = key >> 3;
            const wireType = key & 0x07;
            if (field === 0) {
                break;
            }

            if (wireType === 0) {
                try {
                    const valueResult = this.readVarint(buffer, offset);
                    offset = valueResult.offset;
                    results.push({ field, wireType, data: valueResult.value });
                } catch {
                    break;
                }
                continue;
            }

            if (wireType === 2) {
                try {
                    const lengthResult = this.readVarint(buffer, offset);
                    const length = lengthResult.value;
                    offset = lengthResult.offset;

                    if (length < 0 || offset + length > buffer.length) {
                        break;
                    }

                    const innerBuffer = buffer.subarray(offset, offset + length);
                    offset += length;
                    results.push({ field, wireType, data: innerBuffer });
                } catch {
                    break;
                }
                continue;
            }

            if (wireType === 1) {
                const end = offset + 8;
                if (end > buffer.length) {
                    break;
                }
                results.push({ field, wireType, data: buffer.subarray(offset, end) });
                offset = end;
                continue;
            }

            if (wireType === 5) {
                const end = offset + 4;
                if (end > buffer.length) {
                    break;
                }
                results.push({ field, wireType, data: buffer.subarray(offset, end) });
                offset = end;
                continue;
            }

            break;
        }

        return results;
    }

    /**
     * Decodes a protobuf-encoded Buffer into a typed JavaScript object using the provided schema.
     *
     * The schema maps field numbers to their names, types, and optional nested sub-schemas.
     * Wire-type validation ensures only correctly-typed fields are assigned; mismatches are
     * silently skipped. For non-repeated fields, the last valid occurrence wins.
     *
     * @param buffer - Raw protobuf binary data
     * @param schema - Schema definition mapping field numbers to type descriptors
     * @returns The decoded object cast to the generic type `T`
     */
    public decode<T = unknown>(buffer: Buffer, schema: SchemaDefinition): T {
        const rawFields = this.parseRawFields(buffer);
        const result: Record<string, unknown> = {};

        const fieldGroups: Record<number, ProtoFieldRaw[]> = {};
        for (const field of rawFields) {
            if (!fieldGroups[field.field]) {
                fieldGroups[field.field] = [];
            }
            fieldGroups[field.field].push(field);
        }

        for (const [tagStr, meta] of Object.entries(schema)) {
            const tag = Number(tagStr);
            const items = fieldGroups[tag];
            if (!items || items.length === 0) {
                continue;
            }

            const { name, type, repeated, schema: subSchema } = meta;

            const parseValue = (item: ProtoFieldRaw) => {
                // Validate wire type matches expected type, skip garbage
                const wt = item.wireType;

                if (type === "int" || type === "long") {
                    if (wt !== 0) return undefined;
                    return Number(item.data);
                }
                if (type === "bool") {
                    if (wt !== 0) return undefined;
                    return item.data === 1;
                }
                if (type === "string") {
                    if (wt !== 2 || !Buffer.isBuffer(item.data)) return undefined;
                    return item.data.toString("utf8");
                }
                if (type === "bytes") {
                    if (wt !== 2 || !Buffer.isBuffer(item.data)) return undefined;
                    return item.data;
                }
                if (type === "message") {
                    if (wt !== 2 || !Buffer.isBuffer(item.data)) return undefined;
                    if (subSchema) return this.decode(item.data, subSchema);
                    return undefined;
                }
                if (type === "double") {
                    if (wt !== 1 || !Buffer.isBuffer(item.data) || item.data.length !== 8) return undefined;
                    return item.data.readDoubleLE(0);
                }
                if (type === "float") {
                    if (wt !== 5 || !Buffer.isBuffer(item.data) || item.data.length !== 4) return undefined;
                    return item.data.readFloatLE(0);
                }

                return undefined;
            };

            if (repeated) {
                result[name] = items.map((item) => parseValue(item)).filter((v) => v !== undefined);
            } else {
                // Take the last occurrence that parses successfully (skip trailing garbage)
                for (let i = items.length - 1; i >= 0; i--) {
                    const value = parseValue(items[i]);
                    if (value !== undefined) {
                        result[name] = value;
                        break;
                    }
                }
            }
        }

        return result as T;
    }
}
