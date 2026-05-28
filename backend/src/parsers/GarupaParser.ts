import type { SchemaDefinition } from "@/types/garupaSchema/schemaDefinition";

interface ProtoFieldRaw {
    field: number;
    wireType: number;
    data: number | Buffer;
}

export class GarupaParser {
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
                if (type === "int") {
                    return Number(item.data);
                }
                if (type === "bool") {
                    return item.data === 1;
                }

                if (item.wireType === 2 && Buffer.isBuffer(item.data)) {
                    if (type === "string") {
                        return item.data.toString("utf8");
                    }
                    if (type === "bytes") {
                        return item.data;
                    }
                    if (type === "message" && subSchema) {
                        return this.decode(item.data, subSchema);
                    }
                }

                if (Buffer.isBuffer(item.data)) {
                    if (type === "double" && item.wireType === 1 && item.data.length === 8) {
                        return item.data.readDoubleLE(0);
                    }
                    if (type === "float" && item.wireType === 5 && item.data.length === 4) {
                        return item.data.readFloatLE(0);
                    }
                }

                return item.data;
            };

            if (repeated) {
                result[name] = items.map((item) => parseValue(item));
            } else {
                result[name] = parseValue(items[items.length - 1]);
            }
        }

        return result as T;
    }
}
