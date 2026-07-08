/**
 * 测试国服 API 哪些 header 是真正必需的
 * 逐项删减，验证请求是否仍然成功
 */
import { Buffer } from "node:buffer";
import { CN_BASE_URL, CN_CLIENT_VERSION, CN_UID, CN_UUID, decryptCn } from "./config";

// 完整的 header 集合（从抓包）
const FULL_HEADERS: Record<string, string> = {
    "User-Agent": "UnityPlayer/2022.3.62f3c1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
    "Accept-Encoding": "deflate, gzip",
    "Content-Type": "application/octet-stream",
    Accept: "application/octet-stream",
    "X-ClientVersion": CN_CLIENT_VERSION,
    "X-DataVersion": "9.4.3.2",
    "X-MasterDataVersion": "2026070610000000",
    "X-Signature": CN_UUID,
    "X-Token": "test-token-placeholder",
    "X-ChannelID": "1",
    "X-PlatformID": "2",
    "X-DeviceID": "test-device-id-placeholder",
    "X-ClientPlatform": "Android",
    "X-Unity-Version": "2022.3.62f3c1",
};

function randRid(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function extractRid(decrypted: Buffer): string | null {
    const m = decrypted.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return m?.[1] ?? null;
}

async function testWithHeaders(headers: Record<string, string>, _label: string, rid: string): Promise<{ ok: boolean; detail: string }> {
    try {
        const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
        const response = await fetch(url, { headers: { ...headers, "X-Requestid": rid } });
        const raw = Buffer.from(await response.arrayBuffer());

        if (raw.length === 0) return { ok: false, detail: `HTTP ${response.status}, 空响应` };

        const dec = decryptCn(raw);
        if (response.status === 200 && dec.length > 100) {
            return { ok: true, detail: `HTTP 200, ${dec.length}B` };
        }

        // 可能是 405（rid 错误） - 这算"headers 被接受"
        const newRid = extractRid(dec);
        if (response.status === 405 && newRid) {
            return { ok: true, detail: `HTTP 405 (rid error, headers OK)` };
        }

        const text = dec
            .toString("utf8")
            .replace(/[^\x20-\x7e]/g, ".")
            .substring(0, 100);
        return { ok: false, detail: `HTTP ${response.status}, ${text}` };
    } catch (e) {
        return { ok: false, detail: `Error: ${(e as Error).message}` };
    }
}

async function main() {
    console.log("=== 国服 API 必需 Header 测试 ===\n");
    console.log("测试端点: /user/{uid}/monthlyranking/18/ranking\n");

    const results: { label: string; ok: boolean; detail: string }[] = [];

    // 1. 完整 headers（基准）
    const r1 = await testWithHeaders(FULL_HEADERS, "完整 headers (基准)", randRid());
    results.push({ label: "完整 headers", ...r1 });
    console.log(`✅ 完整 headers: ${r1.detail}`);

    // 2. 逐个去掉 header 测试
    const optionalTests = [
        { remove: "X-DataVersion", desc: "去掉 X-DataVersion" },
        { remove: "X-MasterDataVersion", desc: "去掉 X-MasterDataVersion" },
        { remove: "X-ChannelID", desc: "去掉 X-ChannelID" },
        { remove: "X-PlatformID", desc: "去掉 X-PlatformID" },
        { remove: "X-DeviceID", desc: "去掉 X-DeviceID" },
        { remove: "X-Token", desc: "去掉 X-Token" },
        { remove: "X-ClientPlatform", desc: "去掉 X-ClientPlatform" },
        { remove: "X-Unity-Version", desc: "去掉 X-Unity-Version" },
        { remove: "Accept-Encoding", desc: "去掉 Accept-Encoding" },
        { remove: "Content-Type", desc: "去掉 Content-Type" },
        { remove: "Accept", desc: "去掉 Accept" },
    ];

    for (const t of optionalTests) {
        const h = { ...FULL_HEADERS };
        delete h[t.remove];
        const r = await testWithHeaders(h, t.desc, randRid());
        const icon = r.ok ? "✅" : "❌";
        results.push({ label: t.desc, ...r });
        console.log(`${icon} ${t.desc}: ${r.detail}`);
    }

    // 3. 最简组合测试
    console.log("\n--- 最简组合测试 ---");

    // 只保留看起来必需的
    const minimal1 = {
        "X-ClientVersion": FULL_HEADERS["X-ClientVersion"],
        "X-Signature": FULL_HEADERS["X-Signature"],
    };
    const mr1 = await testWithHeaders(minimal1, "仅 X-ClientVersion + X-Signature", randRid());
    console.log(`${mr1.ok ? "✅" : "❌"} 仅 ClientVer+Sign: ${mr1.detail}`);

    const minimal2 = {
        "User-Agent": FULL_HEADERS["User-Agent"],
        "X-ClientVersion": FULL_HEADERS["X-ClientVersion"],
        "X-Signature": FULL_HEADERS["X-Signature"],
    };
    const mr2 = await testWithHeaders(minimal2, "UA + ClientVer + Sign", randRid());
    console.log(`${mr2.ok ? "✅" : "❌"} UA+ClientVer+Sign: ${mr2.detail}`);

    // 4. 只测试 /api/application（不需要 rid）
    console.log("\n--- /api/application 端点测试 ---");
    try {
        const url = new URL("application", CN_BASE_URL).toString();
        const r = await fetch(url, { headers: { "X-ClientVersion": "9.4.3" } });
        console.log(`仅 X-ClientVersion: HTTP ${r.status}, ${Buffer.from(await r.arrayBuffer()).length}B`);
    } catch (e) {
        console.log(`Error: ${(e as Error).message}`);
    }

    console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
