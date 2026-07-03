import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import {
    GARUPA_CLIENT_PLATFORMS,
    GARUPA_CLIENT_VERSIONS,
    GARUPA_ENCRYPTION_IVS,
    GARUPA_ENCRYPTION_KEYS,
    GARUPA_SERVER_BASES,
    GARUPA_UIDS,
    GARUPA_UNITY_VERSIONS,
    GARUPA_USER_AGENTS,
    GARUPA_UUIDS,
} from "@/config";
import { GarupaParser } from "@/parsers/GarupaParser";
import { type GarupaMonthlyRankingRankingResponse, userMonthlyRankingRankingResponseSchema } from "@/types/garupaSchema/monthlyRankingRankingSchema";

interface ProbeNode {
    field: number;
    wireType: number;
    data: number | Buffer | ProbeNode[];
}

const readVarint = (buffer: Buffer, offset: number): { value: number; offset: number } => {
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
            throw new Error("varint too large");
        }
    }
    throw new Error("unexpected end while reading varint");
};

const parseProbe = (buffer: Buffer): ProbeNode[] => {
    const out: ProbeNode[] = [];
    let offset = 0;

    while (offset < buffer.length) {
        const key = readVarint(buffer, offset);
        offset = key.offset;
        if (key.value === 0) break;
        const field = key.value >> 3;
        const wireType = key.value & 0x07;

        if (wireType === 0) {
            const val = readVarint(buffer, offset);
            offset = val.offset;
            out.push({ field, wireType, data: val.value });
            continue;
        }

        if (wireType === 2) {
            const len = readVarint(buffer, offset);
            offset = len.offset;
            const end = offset + len.value;
            if (end > buffer.length) break;
            out.push({ field, wireType, data: buffer.subarray(offset, end) });
            offset = end;
            continue;
        }

        if (wireType === 1) {
            const end = offset + 8;
            if (end > buffer.length) break;
            out.push({ field, wireType, data: buffer.subarray(offset, end) });
            offset = end;
            continue;
        }

        if (wireType === 5) {
            const end = offset + 4;
            if (end > buffer.length) break;
            out.push({ field, wireType, data: buffer.subarray(offset, end) });
            offset = end;
            continue;
        }
        break;
    }
    return out;
};

const asUtf8 = (buffer: Buffer): string | null => {
    const text = buffer.toString("utf8");
    if (text.includes("\uFFFD")) return null;
    if (!Buffer.from(text, "utf8").equals(buffer)) return null;
    return text;
};

const naiveCanParseAsMessage = (buffer: Buffer): boolean => {
    try {
        parseProbe(buffer);
        return true;
    } catch {
        return false;
    }
};

const toBaseUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "-") throw new Error("invalid base url config");
    return /^https?:\/\//i.test(trimmed) ? (trimmed.endsWith("/") ? trimmed : `${trimmed}/`) : `https://${trimmed.replace(/\/+$/, "")}/api/`;
};

const resolveServerValue = (values: string[], server: number): string => {
    const raw = values[server] ?? values[0] ?? "";
    if (!raw.trim() || raw.trim() === "-") throw new Error(`missing config for server ${server}`);
    return raw.trim();
};

const fetchAndDecrypt = async (server: number, monthlyId: number): Promise<Buffer> => {
    const base = toBaseUrl(resolveServerValue(GARUPA_SERVER_BASES, server));
    const uid = resolveServerValue(GARUPA_UIDS, server);
    const uuid = resolveServerValue(GARUPA_UUIDS, server);

    const url = new URL(`user/${uid}/monthlyranking/${monthlyId}/ranking`, base);
    url.searchParams.set("server", String(server));

    const headers = {
        "User-Agent": resolveServerValue(GARUPA_USER_AGENTS, server),
        "X-Unity-Version": resolveServerValue(GARUPA_UNITY_VERSIONS, server),
        "X-ClientPlatform": resolveServerValue(GARUPA_CLIENT_PLATFORMS, server),
        "X-ClientVersion": resolveServerValue(GARUPA_CLIENT_VERSIONS, server),
        "X-Signature": uuid,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    } as const;

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const encrypted = Buffer.from(await response.arrayBuffer());
    const decipher = crypto.createDecipheriv(
        "aes-128-cbc",
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_KEYS, server)),
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_IVS, server)),
    );
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

const getTopUserNameRawBuffers = (payload: Buffer): Buffer[] => {
    const root = parseProbe(payload);
    const topContainer = root.find((node) => node.field === 2 && node.wireType === 2);
    if (!topContainer || !Buffer.isBuffer(topContainer.data)) return [];

    const topRows = parseProbe(topContainer.data);
    const out: Buffer[] = [];
    for (const row of topRows) {
        if (row.field !== 1 || row.wireType !== 2 || !Buffer.isBuffer(row.data)) continue;
        const userFields = parseProbe(row.data);
        const nameField = userFields.find((f) => f.field === 1 && f.wireType === 2 && Buffer.isBuffer(f.data));
        if (nameField && Buffer.isBuffer(nameField.data)) {
            out.push(nameField.data);
        }
    }
    return out;
};

const main = async (): Promise<void> => {
    const server = Number(process.argv[2] ?? 0);
    const monthlyId = Number(process.argv[3] ?? 20);

    const payload = await fetchAndDecrypt(server, monthlyId);

    // 调用通用解析器核心进行解码
    const rawContractDecoded = new GarupaParser().decode<GarupaMonthlyRankingRankingResponse>(payload, userMonthlyRankingRankingResponseSchema);
    console.dir(rawContractDecoded, { depth: 3 });
    const parsed = {
        monthlyRankingPointTopUsers: (rawContractDecoded.monthlyRankingPointTopUsers?.entries ?? []).map((u) => ({
            name: u.name ?? "",
            uid: u.userId ?? 0,
        })),
    };

    const missingNameUsers = parsed.monthlyRankingPointTopUsers.filter((u) => !u.name || u.name.trim().length === 0);
    const nameRawBuffers = getTopUserNameRawBuffers(payload);

    const rawStats = nameRawBuffers.slice(0, 10).map((buf, index) => {
        const text = asUtf8(buf);
        return {
            index,
            bytes: buf.length,
            utf8Text: text,
            oldParserWouldTreatAsMessage: naiveCanParseAsMessage(buf),
        };
    });

    const report = {
        server,
        monthlyId,
        topUsersCount: parsed.monthlyRankingPointTopUsers.length,
        missingNameCount: missingNameUsers.length,
        missingNameUids: missingNameUsers.map((u) => u.uid).slice(0, 10),
        suspiciousNameDrops: nameRawBuffers
            .map((buf, index) => ({
                index,
                rawText: asUtf8(buf) ?? "",
                parsedName: parsed.monthlyRankingPointTopUsers[index]?.name ?? "",
                uid: parsed.monthlyRankingPointTopUsers[index]?.uid ?? 0,
            }))
            .filter((row) => row.rawText.trim().length > 0 && row.parsedName.trim().length === 0),
        nameFieldRawProbe: rawStats,
    };

    console.log(JSON.stringify(report, null, 2));
};

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
