import { constants } from "node:zlib";
import compress from "koa-compress";

export const responseCompression = compress({
    threshold: 1024,
    encodingPreference: ["br", "gzip", "identity"],
    br: { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } },
    gzip: { level: 6 },
    deflate: false,
    zstd: false,
});
