import * as crypto from "node:crypto";
import { downloader } from "@/storage/downloader";
jest.mock("@/storage/downloader", () => ({ downloader: { downloadRaw: jest.fn() } }));
const downloadRaw = jest.mocked(downloader.downloadRaw);

import { type CnConfig, CnSessionClient, cnField, decryptCn, encryptCn, readCnFields, signCnSdk } from "./cnSession";

const config: CnConfig = {
    encryptionKey: Buffer.from("test-key-1234567"),
    encryptionIv: Buffer.from("test-iv--1234567"),
    requestKey: "test-request-key",
    sdkAppKey: "test-sdk-app-key",
    account: "test-account",
    password: "test-password",
    sdkBase: "https://sdk.example",
    deviceId: "test-device",
    buvid: "test-buvid",
    sdkUdid: "independent-udid+/=",
    bdId: "test-bd",
    deviceModel: "test-model",
    deviceOs: "test-os",
    adId: "test-seed",
    apkSign: "test-apk-sign",
    sdkVersion: "test-sdk-version",
    userAgent: "test-agent",
    channelId: "1",
    platformId: "2",
    clientPlatform: "Android",
    versionCode: "105",
    unityVersion: "2022.3.62f3c1",
    loginTimeoutMs: 30000,
    retryDelayMs: 5000,
};
const base = "https://game.example/api/";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const binary = (body: Buffer, headers = {}) => new Response(new Uint8Array(encryptCn(body, config.encryptionKey, config.encryptionIv)), { headers });
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const rid = (s: string) => md5(`${config.requestKey}${s}`);
function fixture() {
    let time = 10000;
    let count = 0;
    let next: (() => Response | Promise<Response>) | undefined;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/application")) return binary(Buffer.concat([cnField(1, "9.4.4"), cnField(2, "9.4.3.21"), cnField(10, "2026091414000000")]));
        if (url.includes("/issue/cipher/"))
            return Response.json({ code: 0, hash: "fresh-hash", cipher_key: publicKey.export({ type: "spki", format: "pem" }) });
        if (url.includes("/external/login/")) return Response.json({ code: 0, uid: "9007199254740993", access_key: "fresh-access" });
        if (url.endsWith("/user/login")) return binary(Buffer.from([8, 123]), { "X-Token": `token-${++count}`, "X-Requestid": `login-${count}` });
        if (next) return next();
        return binary(Buffer.from("ranking"), { "X-Requestid": "next-nonce" });
    });
    downloadRaw.mockReset();
    downloadRaw.mockImplementation(async (url, headers) => {
        const response = await transport(url, { headers });
        return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) };
    });
    return {
        calls,
        transport,
        client: new CnSessionClient(config, transport as typeof fetch, () => time),
        advance: () => {
            time += 5000;
        },
        respond: (fn: typeof next) => {
            next = fn;
        },
    };
}
const url = (uid: string) => `${base}suite/user/${uid}`;

test("fresh password login encrypts hash+password, preserves uint64 SDK UID and uses returned game UID", async () => {
    const f = fixture();
    expect((await f.client.fetch(base, "9.4.4", url)).decrypted.toString()).toBe("ranking");
    const form = new URLSearchParams(f.calls[2].init.body as string);
    // Raw RSA decrypt lets the test inspect PKCS#1 v1.5 padding even on Node builds disabling legacy privateDecrypt padding.
    const padded = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(form.get("pwd") ?? "", "base64"));
    expect(padded.subarray(0, 2)).toEqual(Buffer.from([0, 2]));
    expect(padded.subarray(padded.indexOf(0, 2) + 1).toString()).toBe("fresh-hashtest-password");
    expect(form.get("user_id")).toBe(config.account);
    expect(new Headers(f.calls[3].init.headers).has("X-Requestid")).toBe(false);
    expect(form.get("bd_id")).toBe(config.bdId);
    expect(form.get("cur_buvid")).toBe(config.buvid);
    expect(form.get("udid")).toBe(config.sdkUdid);
    expect(new Headers(f.calls[2].init.headers).get("User-Agent")).toBe("Mozilla/5.0 BSGameSDK");
    expect(form.get("apk_sign")).toBe(config.apkSign);
    expect(f.calls[2].url).toBe("https://sdk.example/api/external/login/v3");
    expect(new Headers(f.calls[4].init.headers).get("X-DeviceID")).toBe(config.deviceId);
    const payload = readCnFields(decryptCn(Buffer.from(f.calls[3].init.body as Uint8Array), config.encryptionKey, config.encryptionIv));
    expect(payload.get(1)?.[0].toString()).toBe("9007199254740993");
    expect(payload.get(3)?.[0].toString()).toBe("Android");
    expect(f.calls[4].url).toBe(`${base}suite/user/123`);
    expect(new Headers(f.calls[4].init.headers).get("X-Requestid")).toBe(rid("login-1"));
    expect(new Headers(f.calls[4].init.headers).get("X-PlatformID")).toBe("2");
    expect(new Headers(f.calls[4].init.headers).get("X-Token")).toBe("token-1");
    expect(new Headers(f.calls[4].init.headers).has("X-Signature")).toBe(false);
});

test("SDK sign sorts values and excludes reserved fields case-insensitively", () => {
    expect(signCnSdk({ z: "last", a: "first", TOKEN: "ignored", sign: "ignored" }, config.sdkAppKey)).toBe(md5("firstlasttest-sdk-app-key"));
});

test("concurrent authenticated calls serialize and use the preceding response nonce", async () => {
    const f = fixture();
    await Promise.all([f.client.fetch(base, "9.4.4", url), f.client.fetch(base, "9.4.4", url)]);
    expect(f.calls).toHaveLength(6);
    expect(new Headers(f.calls[5].init.headers).get("X-Requestid")).toBe(rid("next-nonce"));
});

test("405 body and header recovery hints are ignored; after cooldown a fresh login is required", async () => {
    const f = fixture();
    f.respond(() => new Response("newRequestId=legacy-hint", { status: 405, headers: { "X-Requestid": "legacy-hint" } }));
    expect(await f.client.fetch(base, "9.4.4", url)).toMatchObject({ status: 405, decrypted: Buffer.alloc(0) });
    await expect(f.client.fetch(base, "9.4.4", url)).rejects.toThrow("cooling down");
    expect(f.calls).toHaveLength(5);
    f.advance();
    f.respond(undefined);
    await f.client.fetch(base, "9.4.4", url);
    expect(f.calls).toHaveLength(10);
    expect(new Headers(f.calls[9].init.headers).get("X-Token")).toBe("token-2");
    expect(new Headers(f.calls[9].init.headers).get("X-Requestid")).toBe(rid("login-2"));
});

test("downloader failure invalidates the session and forces fresh login after cooldown", async () => {
    const f = fixture();
    f.respond(() => {
        throw new Error("downloader upstream request failed");
    });
    await expect(f.client.fetch(base, "9.4.4", url)).rejects.toThrow("downloader upstream request failed");
    f.advance();
    f.respond(undefined);
    await f.client.fetch(base, "9.4.4", url);
    expect(f.calls.filter((c) => c.url.endsWith("/user/login"))).toHaveLength(2);
});

test("success without nonce preserves the chain; token and nonce rotate independently", async () => {
    const f = fixture();
    f.respond(() => binary(Buffer.from("data"), { "X-Token": "rotated-token" }));
    await f.client.fetch(base, "9.4.4", url);
    f.respond(() => binary(Buffer.from("data"), { "X-Requestid": "rotated-nonce", "X-Token": "" }));
    await f.client.fetch(base, "9.4.4", url);
    expect(new Headers(f.calls[5].init.headers).get("X-Requestid")).toBe(rid("login-1"));
    expect(new Headers(f.calls[5].init.headers).get("X-Token")).toBe("rotated-token");
    f.respond(() => binary(Buffer.from("data")));
    await f.client.fetch(base, "9.4.4", url);
    expect(new Headers(f.calls[6].init.headers).get("X-Requestid")).toBe(rid("rotated-nonce"));
    expect(new Headers(f.calls[6].init.headers).get("X-Token")).toBe("rotated-token");
    expect(f.calls.filter((c) => c.url.endsWith("/user/login"))).toHaveLength(1);
});

test.each([200005, 200006, 200007, 200000, 200001])("SDK verification code %s stops login without retry or data request", async (code) => {
    const f = fixture();
    const transport: typeof fetch = async (input, init) =>
        String(input).includes("/external/login/") ? Response.json({ code, message: "secret-password" }) : f.transport(input, init);
    const client = new CnSessionClient(config, transport);
    await expect(client.fetch(base, "9.4.4", url)).rejects.toThrow(`CN SDK verification required (code ${code}); CAPTCHA login is not supported; login stopped`);
    await expect(client.fetch(base, "9.4.4", url)).rejects.toThrow("cooling down");
    expect(f.calls.filter((c) => c.url.endsWith("/user/login"))).toHaveLength(0);
    expect(downloadRaw).not.toHaveBeenCalled();
});

test("malformed protobuf and ciphertext are rejected", () => {
    expect(() => readCnFields(Buffer.from([10, 255]))).toThrow();
    expect(() => decryptCn(Buffer.from("invalid"), config.encryptionKey, config.encryptionIv)).toThrow();
});

test.each(["requestKey", "sdkAppKey"] as const)("missing %s fails before any network request", async (key) => {
    const transport = jest.fn();
    const client = new CnSessionClient({ ...config, [key]: "" }, transport);
    await expect(client.fetch(base, "9.4.4", url)).rejects.toThrow("are required");
    expect(transport).not.toHaveBeenCalled();
});

test("missing device identity fails without network access", async () => {
    const transport = jest.fn();
    const client = new CnSessionClient({ ...config, deviceId: "" }, transport);
    await expect(client.fetch(base, "9.4.4", url)).rejects.toThrow("deviceId");
    expect(transport).not.toHaveBeenCalled();
});

test("empty SDK udid reuses the explicitly configured BUVID", async () => {
    const f = fixture();
    const client = new CnSessionClient({ ...config, sdkUdid: "" }, f.transport as typeof fetch);
    await client.fetch(base, "9.4.4", url);
    const form = new URLSearchParams(f.calls[2].init.body as string);
    expect(form.get("udid")).toBe(config.buvid);
    expect(form.get("cur_buvid")).toBe(config.buvid);
    expect(form.get("sign")).toBe(signCnSdk(Object.fromEntries(form), config.sdkAppKey));
});

test.each(["", "explicit-sdk-udid"])("empty BUVID derives from DEVICE_ID, SDK udid override=%s", async (sdkUdid) => {
    const f = fixture();
    const client = new CnSessionClient({ ...config, deviceId: "0123456789abcdef0123456789abcdef", buvid: "", sdkUdid }, f.transport as typeof fetch);
    await client.fetch(base, "9.4.4", url);
    const form = new URLSearchParams(f.calls[2].init.body as string);
    const expected = "XX2C60123456789ABCDEF0123456789ABCDEF";
    expect(form.get("cur_buvid")).toBe(expected);
    expect(form.get("old_buvid")).toBe(expected);
    expect(form.get("udid")).toBe(sdkUdid || expected);
    expect(form.get("sign")).toBe(signCnSdk(Object.fromEntries(form), config.sdkAppKey));
});

test("invalid DEVICE_ID cannot generate BUVID and fails before network access", async () => {
    const transport = jest.fn();
    const client = new CnSessionClient({ ...config, buvid: "", deviceId: "invalid" }, transport);
    await expect(client.fetch(base, "9.4.4", url)).rejects.toThrow("32 hexadecimal");
    expect(transport).not.toHaveBeenCalled();
});

test("empty BD_ID is generated in memory and reused for re-login within the same client", async () => {
    const f = fixture();
    let now = 10000;
    const client = new CnSessionClient({ ...config, bdId: "" }, f.transport as typeof fetch, () => now);
    f.respond(() => new Response("failed", { status: 405 }));
    await client.fetch(base, "9.4.4", url);
    const generated = new URLSearchParams(f.calls[1].init.body as string).get("bd_id");
    expect(generated).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{3}$/,
    );
    now += config.retryDelayMs;
    f.respond(undefined);
    await client.fetch(base, "9.4.4", url);
    for (const i of [2, 6, 7]) expect(new URLSearchParams(f.calls[i].init.body as string).get("bd_id")).toBe(generated);
    const restarted = fixture();
    await new CnSessionClient({ ...config, bdId: "" }, restarted.transport as typeof fetch).fetch(base, "9.4.4", url);
    expect(new URLSearchParams(restarted.calls[1].init.body as string).get("bd_id")).not.toBe(generated);
});

test.each(["cipher_key", "rsa_key"])("-662 replaces RSA material from %s and preserves device identity", async (keyField) => {
    const f = fixture();
    const fresh = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forms: URLSearchParams[] = [];
    const transport: typeof fetch = async (input, init = {}) => {
        if (String(input).includes("/external/login/")) {
            forms.push(new URLSearchParams(init.body as string));
            if (forms.length === 1)
                return Response.json({ code: -662, hash: "replacement-hash", [keyField]: fresh.publicKey.export({ type: "spki", format: "pem" }) });
        }
        return f.transport(input, init);
    };
    let time = 10000;
    const client = new CnSessionClient({ ...config, bdId: "" }, transport, () => ++time);
    expect((await client.fetch(base, "9.4.4", url)).status).toBe(200);
    expect(forms).toHaveLength(2);
    const padded = crypto.privateDecrypt({ key: fresh.privateKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(forms[1].get("pwd")!, "base64"));
    expect(padded.subarray(0, 2)).toEqual(Buffer.from([0, 2]));
    expect(padded.subarray(padded.indexOf(0, 2) + 1).toString()).toBe("replacement-hashtest-password");
    for (const field of ["bd_id", "cur_buvid", "old_buvid", "udid", "user_id"]) expect(forms[1].get(field)).toBe(forms[0].get(field));
    expect(forms[1].get("sign")).toBe(signCnSdk(Object.fromEntries(forms[1]), config.sdkAppKey));
    expect(forms[1].get("timestamp")).not.toBe(forms[0].get("timestamp"));
    expect(f.calls.filter((call) => call.url.includes("/issue/cipher/")).length).toBe(1);
});

test.each([false, true])("-662 stops with missing material or after bounded retries: %s", async (valid) => {
    const f = fixture();
    let logins = 0;
    const client = new CnSessionClient(config, async (input, init) => {
        if (String(input).includes("/external/login/")) {
            logins++;
            return Response.json({ code: -662, hash: "new-hash", ...(valid ? { cipher_key: publicKey.export({ type: "spki", format: "pem" }) } : {}) });
        }
        return f.transport(input, init);
    });
    await expect(client.fetch(base, "9.4.4", url)).rejects.toThrow("code -662");
    expect(logins).toBe(valid ? 4 : 1);
});

test.each(["UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "secret-code"])("transport diagnostics retain safe code and redact secrets: %s", async (code) => {
    const f = fixture();
    f.transport.mockRejectedValueOnce(new Error("secret-token", { cause: Object.assign(new Error("test-password"), { code }) }));
    const expected = code === "secret-code" ? "UNKNOWN" : code;
    await expect(f.client.fetch(base, "9.4.4", url)).rejects.toThrow(`CN request failed (application; ${expected}; 0ms); session discarded`);
});


test("login timeout applies only to login requests; authenticated requests use the general timeout", async () => {
    const timeout = jest.spyOn(AbortSignal, "timeout");
    try {
        const f = fixture();
        await f.client.fetch(base, "9.4.4", url);
        await f.client.fetch(base, "9.4.4", url);
        expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30000, 30000, 30000, 30000]);
        expect(downloadRaw).toHaveBeenCalledTimes(2);
        expect(downloadRaw).toHaveBeenLastCalledWith(
            `${base}suite/user/123`,
            expect.objectContaining({ "X-Token": "token-1", "X-Requestid": rid("next-nonce") }),
        );
    } finally {
        timeout.mockRestore();
    }
});
