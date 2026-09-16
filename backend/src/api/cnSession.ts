import * as crypto from "node:crypto";
import { GarupaParser } from "@/parsers/GarupaParser";
import { applicationResponseSchema, loginResponseSchema, type GarupaApplicationResponse, type GarupaLoginResponse } from "@/types/garupaSchema";
import { downloader } from "@/storage/downloader";

/** 由调用方提供的 SDK 帐号配置、设备信息和游戏会话参数。 / SDK credentials, device profile, and game session settings resolved by the caller. */
export interface CnConfig {
    encryptionKey: Buffer;
    encryptionIv: Buffer;
    requestKey: string;
    sdkAppKey: string;
    account: string;
    password: string;
    sdkBase: string;
    deviceId: string;
    buvid: string;
    sdkUdid: string;
    bdId: string;
    deviceModel: string;
    deviceOs: string;
    adId: string;
    apkSign: string;
    sdkVersion: string;
    userAgent: string;
    channelId: string;
    platformId: string;
    clientPlatform: string;
    versionCode: string;
    unityVersion: string;
    loginTimeoutMs: number;
    retryDelayMs: number;
}
const garupaParser = new GarupaParser();

const md5 = (value: string) => crypto.createHash("md5").update(value).digest("hex");
/**
 * 按字段名排序、排除保留字段后，拼接字段值和配置的签名密钥，生成小写 MD5 表单签名。
 * Computes the SDK form signature from sorted parameter values and the configured app key.
 * Reserved fields are excluded case-insensitively; parameter names are not concatenated.
 * @param params - Form fields before URL encoding
 * @param appKey - SDK signing key from configuration
 * @returns Lowercase hexadecimal MD5 signature
 */
export const signCnSdk = (params: Record<string, string>, appKey: string): string =>
    md5(
        Object.keys(params)
            .sort()
            .filter((key) => !["item_name", "item_desc", "feign_sign", "token", "sign"].includes(key.toLowerCase()))
            .map((key) => params[key])
            .join("") + appKey,
    );

/**
 * 将 protobuf 请求使用配置的 key、IV 进行 AES-128-CBC 加密，手动添加 ISO10126 填充。
 * Encrypts a game request with AES-128-CBC and ISO10126 padding.
 * @param plain - Encoded protobuf message
 * @param key - 16-byte key from configuration
 * @param iv - 16-byte initialization vector from configuration
 * @returns Ciphertext including a full padding block when the input is block-aligned
 */
export function encryptCn(plain: Buffer, key: Buffer, iv: Buffer): Buffer {
    const count = 16 - (plain.length % 16);
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(Buffer.concat([plain, crypto.randomBytes(count - 1), Buffer.from([count])])), cipher.final()]);
}
/**
 * 解密游戏响应并按末尾长度字节去除 ISO10126 填充；密文长度或填充长度非法时抛出异常。
 * Decrypts a game response and removes its ISO10126 padding.
 * @param body - Non-empty ciphertext whose length is a multiple of 16
 * @param key - 16-byte key from configuration
 * @param iv - 16-byte initialization vector from configuration
 * @returns Protobuf bytes without trailing padding
 * @throws If the ciphertext length or the final padding-length byte is invalid
 */
export function decryptCn(body: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (!body.length || body.length % 16) throw new Error("Invalid CN encrypted response");
    const cipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const plain = Buffer.concat([cipher.update(body), cipher.final()]);
    const count = plain[plain.length - 1];
    if (count < 1 || count > 16) throw new Error("Invalid CN response padding");
    return plain.subarray(0, plain.length - count);
}

/** 为 protobuf 字段标签和字节长度编码非负整数。 / Encodes a non-negative integer for protobuf tags and byte lengths. */
const varint = (input: number): Buffer => {
    let n = BigInt(input);
    const bytes: number[] = [];
    while (n >= 128n) {
        bytes.push(Number(n & 127n) | 128);
        n >>= 7n;
    }
    bytes.push(Number(n));
    return Buffer.from(bytes);
};
/**
 * 将字段编号和 UTF-8 字符串或嵌套消息编码为一个长度限定的 protobuf 字段。
 * Encodes one length-delimited protobuf field for a login request.
 * @param number - Protobuf field number
 * @param input - UTF-8 text or an already encoded nested message
 * @returns Field tag, byte length, and value concatenated as a Buffer
 */
export const cnField = (number: number, input: Buffer | string): Buffer => {
    const value = Buffer.isBuffer(input) ? input : Buffer.from(input);
    return Buffer.concat([varint(number * 8 + 2), varint(value.length), value]);
};
/**
 * 构造游戏请求的公共请求头；发送登录态请求时再添加 Token 和 RID，SDK 表单使用独立请求头。
 * Builds shared game headers; session token and request ID are added when sending authenticated requests.
 * @param config - Device, channel, platform, and client settings
 * @param version - Game client version string
 * @returns Headers for game requests, distinct from SDK form headers
 */
export function cnHeaders(config: CnConfig, version: string): Record<string, string> {
    return {
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
        "User-Agent": config.userAgent,
        "X-Unity-Version": config.unityVersion,
        "X-ClientVersion": version,
        "X-DeviceID": config.deviceId,
        "X-ChannelID": config.channelId,
        "X-PlatformID": config.platformId,
        "X-ClientPlatform": config.clientPlatform,
    };
}
/** 遇到验证码要求时停止 SDK 登录，异常只保留数字响应码。 / Stops SDK login when verification is required; retains only the numeric response code. */
export class CnVerificationRequired extends Error {
    constructor(readonly code: number) {
        super(`CN SDK verification required (code ${code}); CAPTCHA login is not supported; login stopped`);
        this.name = "CnVerificationRequired";
    }
}
const CAPTCHA_CODES = new Set([200005, 200006, 200007, 200000, 200001]);

/** 仅在当前进程内保存的游戏会话；游戏 UID 与 SDK 帐号 UID 不同。 / Process-local game session; the game UID is distinct from the SDK account UID. */
interface Session {
    uid: string;
    token: string;
    /** 上一次服务端响应的 nonce，用于计算下一次请求的 RID。 / Last server response nonce, used to derive the next outgoing request ID. */
    nonce: string;
    version: string;
    base: string;
    headers: Record<string, string>;
}
/** 交给现有榜单解析器处理的登录态请求结果。 / Authenticated response passed to the existing ranking parsers. */
export interface CnResponse {
    decrypted: Buffer;
    status: number;
    /** 原始加密响应的字节数。 / Original encrypted response size in bytes. */
    length: number;
}

/**
 * 管理国服帐号密码登录和实例内的 Token/nonce 链。月榜与活动榜复用同一实例串行请求；数据下载使用统一下载器，榜单解析和入库由外层负责。
 * Manages CN password login and one in-memory token/nonce chain per client instance.
 * Authenticated data requests use the shared downloader; ranking parsing and storage remain external.
 * Reuse one instance for monthly and event requests so both advance the same serialized chain.
 */
export class CnSessionClient {
    private session?: Session;
    private bdId?: string;
    private queue: Promise<void> = Promise.resolve();
    private retryAfter = 0;
    /**
     * 创建会话客户端；transport 仅负责登录请求，now 为 SDK 时间戳和重试冷却提供毫秒时钟。
     * @param config - SDK credentials and game session configuration
     * @param transport - HTTP transport for login requests; data requests use the shared downloader
     * @param now - Millisecond clock used for SDK timestamps and retry cooldowns
     */
    constructor(
        private readonly config: CnConfig,
        private readonly transport: typeof fetch = fetch,
        private readonly now = Date.now,
    ) {}

    /** 丢弃当前会话，并开始下一次登录前的冷却计时。 / Discards the current session and starts the cooldown before another login attempt. */
    private invalidate(): void {
        this.session = undefined;
        this.retryAfter = this.now() + this.config.retryDelayMs;
    }
    /**
     * 按登录超时配置发送单个登录相关请求，响应体读取共用该中止信号；网络异常脱敏后抛出，会话失效由外层处理。
     * Sends one login-related HTTP request with the configured login timeout.
     * @param url - SDK or game login-flow URL
     * @param init - Method, headers, and optional request body
     * @returns Response whose body is consumed by the caller under the same abort signal
     * @throws A sanitized transport error; the enclosing session operation handles invalidation
     */
    private async request(url: string, init: RequestInit): Promise<Response> {
        const startedAt = this.now();
        try {
            return await this.transport(url, { ...init, redirect: "error", signal: AbortSignal.timeout(this.config.loginTimeoutMs) });
        } catch (error) {
            // 仅保留已知错误码，原始网络错误信息可能包含登录信息。 / Only expose known error codes; transport messages can contain credentials.
            const allowed = new Set([
                "ECONNRESET",
                "ECONNREFUSED",
                "ENOTFOUND",
                "EAI_AGAIN",
                "ETIMEDOUT",
                "UND_ERR_CONNECT_TIMEOUT",
                "UND_ERR_HEADERS_TIMEOUT",
                "UND_ERR_BODY_TIMEOUT",
                "UND_ERR_SOCKET",
                "ERR_TLS_CERT_ALTNAME_INVALID",
                "CERT_HAS_EXPIRED",
                "DEPTH_ZERO_SELF_SIGNED_CERT",
                "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            ]);
            let code = "UNKNOWN";
            let cause: unknown = error;
            for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
                const detail = cause as { code?: unknown; name?: unknown; cause?: unknown };
                if (typeof detail.code === "string" && allowed.has(detail.code)) {
                    code = detail.code;
                    break;
                }
                if (detail.name === "TimeoutError") code = "REQUEST_TIMEOUT";
                if (detail.name === "AbortError") code = "REQUEST_ABORTED";
                cause = detail.cause;
            }
            const path = new URL(url).pathname;
            const stage = path.endsWith("/issue/cipher/v3")
                ? "SDK cipher"
                : path.endsWith("/external/login/v3")
                  ? "SDK login"
                  : path.endsWith("/user/login")
                    ? "game login"
                    : path.endsWith("/application")
                      ? "application"
                      : "authenticated data";
            throw new Error(`CN request failed (${stage}; ${code}; ${this.now() - startedAt}ms); session discarded`);
        }
    }
    /**
     * 优先使用配置的设备标识；BUVID 留空时由 32 位十六进制设备 ID 生成，SDK UDID 留空时复用 BUVID。设备 ID 格式不符时拒绝生成。
     * Resolves SDK identifiers from explicit configuration or the device-ID fallback.
     * Empty BUVID is derived from a 32-digit hexadecimal device ID; empty SDK UDID reuses BUVID.
     * @throws If BUVID must be generated but the device ID has an incompatible format
     */
    private deviceIdentifiers(): { buvid: string; sdkUdid: string } {
        let buvid = this.config.buvid;
        if (!buvid) {
            const id = this.config.deviceId;
            if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error("CN DEVICE_ID must be 32 hexadecimal characters to generate BUVID");
            buvid = `XX${id[2]}${id[12]}${id[22]}${id}`.toUpperCase();
        }
        return { buvid, sdkUdid: this.config.sdkUdid || buvid };
    }

    /**
     * 优先使用配置的 BD ID，否则在当前实例内生成一次并复用；重新登录不改变该值，也不写入持久化存储。
     * Uses the configured BD ID or generates one once per client instance.
     * The generated value survives re-login within this instance and is never persisted.
     */
    private resolveBdId(): string {
        if (this.config.bdId) return this.config.bdId;
        this.bdId ??= `${crypto.randomUUID()}-${crypto.randomUUID()}`.slice(0, 64).toLowerCase();
        return this.bdId;
    }

    /**
     * 将服务端 hash 与配置的密码拼接，使用 RSA PKCS#1 v1.5 加密并输出 Base64；公钥接受 PEM 或其 Base64 内容。
     * Encrypts the server hash followed by the configured password using RSA PKCS#1 v1.5.
     * @param cipher - Server hash and public key, accepting PEM or its Base64 contents
     * @returns Base64 ciphertext for the SDK password field
     * @throws If required key material is missing or RSA encryption fails
     */
    private encryptPassword(cipher: Record<string, unknown>): string {
        if (typeof cipher.hash !== "string" || typeof cipher.cipher_key !== "string") throw new Error("Missing CN RSA public key");
        const publicKey = cipher.cipher_key.includes("BEGIN")
            ? cipher.cipher_key
            : `-----BEGIN PUBLIC KEY-----\n${cipher.cipher_key}\n-----END PUBLIC KEY-----`;
        try {
            return crypto
                .publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(cipher.hash + this.config.password))
                .toString("base64");
        } catch {
            throw new Error("Invalid CN RSA public key");
        }
    }

    /**
     * 组装、签名并提交 SDK 表单。登录返回 -662 且携带新的 RSA 材料时最多重试三次；需要验证码时直接报错停止。
     * Builds, signs, and submits an SDK form request.
     * Login responses with code -662 and replacement RSA material permit at most three retries.
     * Verification-required responses stop immediately; no CAPTCHA submission is implemented.
     * @param path - SDK path resolved against the configured SDK base
     * @param version - Game version sent as the SDK app version
     * @param extra - Operation-specific form fields
     * @returns Parsed SDK response with success code zero
     * @throws On transport, response-format, verification, or SDK rejection errors
     */
    private async sdk(path: string, version: string, extra: Record<string, string>): Promise<Record<string, unknown>> {
        const { buvid, sdkUdid } = this.deviceIdentifiers();
        const p: Record<string, string> = {
            app_id: "330",
            game_id: "330",
            merchant_id: "1",
            server_id: "557",
            channel_id: "1",
            platform: "3",
            platform_type: "3",
            sdk_type: "1",
            sdk_log_type: "1",
            sdk_ver: this.config.sdkVersion,
            version: "3",
            timestamp: String(this.now()),
            domain: new URL(this.config.sdkBase).host,
            original_domain: this.config.sdkBase,
            cur_buvid: buvid,
            old_buvid: buvid,
            udid: sdkUdid,
            bd_id: this.resolveBdId(),
            apk_sign: this.config.apkSign,
            app_ver: version,
            version_code: this.config.versionCode,
            current_env: "0",
            domain_switch_count: "0",
            ad_info: '{"server_type":"0"}',
            ad_ext: '{"server_type":"0"}',
            ...extra,
        };
        for (let attempt = 0; ; attempt++) {
            p.timestamp = String(this.now());
            p.sign = signCnSdk(p, this.config.sdkAppKey);
            const response = await this.request(new URL(path, this.config.sdkBase).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 BSGameSDK" },
                body: new URLSearchParams(Object.entries(p).filter(([, value]) => value !== "")).toString(),
            });
            if (response.status !== 200) throw new Error(`CN SDK HTTP ${response.status}`);
            let value: Record<string, unknown>;
            try {
                value = (await response.json()) as Record<string, unknown>;
            } catch {
                throw new Error("Invalid CN SDK response");
            }
            if (value && CAPTCHA_CODES.has(Number(value.code))) throw new CnVerificationRequired(Number(value.code));
            const replacementKey = typeof value?.cipher_key === "string" && value.cipher_key ? value.cipher_key : value?.rsa_key;
            if (
                path === "/api/external/login/v3" &&
                Number(value?.code) === -662 &&
                typeof value.hash === "string" &&
                value.hash.length > 0 &&
                typeof replacementKey === "string" &&
                replacementKey.length > 0 &&
                attempt < 3
            ) {
                p.pwd = this.encryptPassword({ hash: value.hash, cipher_key: replacementKey });
                continue;
            }
            if (!value || String(value.code) !== "0") {
                const code = value && /^-?\d+$/.test(String(value.code)) ? String(value.code) : "invalid";
                throw new Error(`CN SDK login rejected (code ${code}); check credentials or complete verification in the official client`);
            }
            return value;
        }
    }
    /**
     * 获取游戏版本信息，通过 SDK 帐号密码认证，再交换游戏 UID、Token 和初始 nonce。配置缺失、版本不符或登录失败时抛出异常。
     * Establishes a new game session using the configured account and password.
     * Fetches game version metadata, authenticates with the SDK, then exchanges its credentials
     * for a game UID, token, and initial response nonce. No previous session is reused here.
     * @param base - Normalized game API base URL
     * @param version - Expected game client version
     * @returns Complete in-memory session for subsequent authenticated requests
     * @throws On missing configuration, version mismatch, login failure, or incomplete session data
     */
    private async login(base: string, version: string): Promise<Session> {
        if (!this.config.account || !this.config.password) throw new Error("GARUPA_CN_ACCOUNT and GARUPA_CN_PASSWORD are required for CN rankings");
        if (!/^\d+$/.test(this.config.versionCode)) throw new Error("GARUPA_CN_VERSION_CODE must be numeric and match the client version");
        if (this.config.encryptionKey.length !== 16 || this.config.encryptionIv.length !== 16) throw new Error("CN AES key and IV must be 16 bytes");
        if (!this.config.requestKey || this.config.requestKey === "-" || !this.config.sdkAppKey || this.config.sdkAppKey === "-")
            throw new Error("GARUPA_RKEYS[3] and GARUPA_CN_SDK_APP_KEY are required");
        for (const key of [
            "sdkBase",
            "deviceId",
            "deviceModel",
            "deviceOs",
            "adId",
            "apkSign",
            "sdkVersion",
            "userAgent",
            "channelId",
            "platformId",
            "clientPlatform",
        ] as const) {
            if (!this.config[key] || this.config[key] === "-") throw new Error(`Missing CN configuration: ${key}`);
        }
        this.deviceIdentifiers();
        const sdkUrl = new URL(this.config.sdkBase);
        if (sdkUrl.protocol !== "https:" || sdkUrl.username || sdkUrl.password) throw new Error("CN SDK base must be an HTTPS URL without credentials");
        const headers = cnHeaders(this.config, version);
        const application = await this.request(new URL("application", base).toString(), { headers });
        if (application.status !== 200) throw new Error(`CN application HTTP ${application.status}`);
        const metadata = garupaParser.decode<Partial<GarupaApplicationResponse>>(
            decryptCn(Buffer.from(await application.arrayBuffer()), this.config.encryptionKey, this.config.encryptionIv),
            applicationResponseSchema,
        );
        const { dataVersion, masterDataVersion: masterVersion } = metadata;
        if (metadata.clientVersion !== version || !dataVersion || !masterVersion) throw new Error("CN application/client version mismatch");
        const cipher = await this.sdk("/api/external/issue/cipher/v3", version, { cipher_type: "bili_login_rsa" });
        const pwd = this.encryptPassword(cipher);
        const sdk = await this.sdk("/api/external/login/v3", version, { user_id: this.config.account, pwd });
        if (
            !/^[1-9]\d*$/.test(String(sdk.uid)) ||
            (typeof sdk.uid === "number" && !Number.isSafeInteger(sdk.uid)) ||
            typeof sdk.access_key !== "string" ||
            !sdk.access_key
        )
            throw new Error("Missing CN SDK credentials");
        const device = Buffer.concat([cnField(1, this.config.adId), cnField(2, this.config.deviceId)]);
        const body = Buffer.concat(
            [String(sdk.uid), sdk.access_key, "Android", this.config.deviceModel, this.config.deviceOs, version, device, "com.bilibili.star.bili"].map((v, i) =>
                cnField(i + 1, v),
            ),
        );
        // 游戏登录从响应建立 nonce 链，请求不发送初始 RID。 / Game login starts the nonce chain from its response; no initial request ID is sent.
        const response = await this.request(new URL("user/login", base).toString(), {
            method: "POST",
            headers: { ...headers, "X-DataVersion": dataVersion },
            body: new Uint8Array(encryptCn(body, this.config.encryptionKey, this.config.encryptionIv)),
        });
        if (response.status !== 200) throw new Error(`CN game login HTTP ${response.status}`);
        const { userId: uid } = garupaParser.decode<Partial<GarupaLoginResponse>>(
            decryptCn(Buffer.from(await response.arrayBuffer()), this.config.encryptionKey, this.config.encryptionIv),
            loginResponseSchema,
        );
        const token = response.headers.get("x-token"),
            nonce = response.headers.get("x-requestid");
        if (typeof uid !== "number" || !Number.isSafeInteger(uid) || uid <= 0 || !token || !nonce) throw new Error("Incomplete CN game session");
        return { uid: String(uid), token, nonce, version, base, headers: { ...headers, "X-DataVersion": dataVersion, "X-MasterDataVersion": masterVersion } };
    }
    /**
     * 将登录、数据下载和会话更新放在同一个串行队列内执行。没有匹配会话时重新登录；成功响应更新非空 Token/nonce，失败响应丢弃会话。
     * Serializes an authenticated data request with login and token/nonce updates.
     * Logs in when no matching session exists, then uses the shared downloader for the data request.
     * Successful non-empty response headers advance the session; failed responses discard it.
     * @param base - Normalized game API base URL
     * @param version - Game client version used to select or create a session
     * @param urlForUser - Builds the data URL from the game UID returned by login
     * @returns Decrypted data on success; an empty buffer and the HTTP status on non-2xx responses
     * @throws On cooldown, login failure, transport failure, or invalid response encryption
     */
    async fetch(base: string, version: string, urlForUser: (uid: string) => string): Promise<CnResponse> {
        const previous = this.queue;
        let release!: () => void;
        this.queue = new Promise<void>((resolve) => {
            release = resolve;
        });
        // 锁覆盖登录、下载及响应处理，避免并发复用同一个 nonce。 / Hold the queue through login, download, and response processing to avoid reusing a nonce.
        await previous;
        try {
            if (this.now() < this.retryAfter) throw new Error("CN login is cooling down after a failed request");
            if (!this.session || this.session.version !== version || this.session.base !== base) this.session = await this.login(base, version);
            const session = this.session;
            const url = urlForUser(session.uid);
            if (new URL(url).origin !== new URL(base).origin) throw new Error("CN authenticated URL origin mismatch");
            const response = await downloader.downloadRaw(
                url,
                { ...session.headers, "X-Token": session.token, "X-Requestid": md5(this.config.requestKey + session.nonce) },
            );
            const { body } = response;
            if (response.status < 200 || response.status >= 300) {
                this.invalidate();
                // 失败响应中的 nonce 不用于更新会话。 / Ignore every error-body/header nonce, including legacy 405 recovery hints.
                return { status: response.status, length: body.length, decrypted: Buffer.alloc(0) };
            }
            const nonce = response.headers["x-requestid"];
            const decrypted = body.length ? decryptCn(body, this.config.encryptionKey, this.config.encryptionIv) : body;
            if (nonce) session.nonce = nonce;
            const token = response.headers["x-token"];
            if (token) session.token = token;
            return { status: response.status, length: body.length, decrypted };
        } catch (error) {
            if (this.now() >= this.retryAfter) this.invalidate();
            throw error;
        } finally {
            release();
        }
    }
}
