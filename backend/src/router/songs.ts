import Router from "@koa/router";
import { getSongsList } from "@/services";

/**
 * 歌曲路由
 *
 * 提供歌曲列表相关的 API 端点，返回歌曲数据。
 */
export const songsRouter = new Router();

/**
 * GET /api/songs
 *
 * 获取歌曲列表
 *
 * 通过服务层获取 Bestdori 的歌曲数据，返回歌曲对象。
 *
 * 错误处理：
 * - 上游请求失败或超时由全局错误中间件统一处理
 * - 此接口不接受任何查询参数
 *
 * @param ctx Koa 请求上下文，用于返回 JSON 响应
 */
songsRouter.get("/songs", async (ctx) => {
    const result = await getSongsList();
    ctx.status = 200;
    ctx.body = result;
});
