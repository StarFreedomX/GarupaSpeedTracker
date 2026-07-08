/**
 * 国服 & 日服 eventType 映射
 *
 * protobuf 中 eventType 字段值与实际 API URL 路径段之间的映射关系。
 * 来源：日服客户端反编译的 URL 模板 + 国服抓包验证。
 *
 * 注意：
 * - protobuf eventType 带下划线（如 live_try），URL 路径无下划线（如 livetry）
 * - 部分类型无法简单去下划线，如 team_live_festival → festival
 * - 日服和国服使用相同的 URL 模板，映射关系一致
 */

/**
 * protobuf eventType → API URL 路径段
 * 用于 buildEventRankingUrl / buildEventRankingMasterListUrl 等函数
 */
export const EVENT_TYPE_TO_URL_SEGMENT: Readonly<Record<string, string>> = {
    challenge: "challenge",
    live_try: "livetry",
    medley: "medley",
    mission_live: "mission",
    story: "story",
    team_live_festival: "festival",
    versus: "versus",
};

/**
 * 便捷函数：将 protobuf eventType 转为 URL 路径段
 */
export function eventTypeToUrlSegment(protobufEventType: string): string {
    return EVENT_TYPE_TO_URL_SEGMENT[protobufEventType] ?? protobufEventType;
}

/**
 * 完整映射对照表（文档用）
 *
 * | protobuf eventType   | URL segment        | 说明                          |
 * |----------------------|--------------------|-------------------------------|
 * | challenge            | challenge          | 一致                          |
 * | live_try             | livetry            | 去下划线                       |
 * | medley               | medley             | 一致                          |
 * | mission_live         | mission            | 非简单去下划线                  |
 * | story                | story              | 一致                          |
 * | team_live_festival   | festival           | 非简单去下划线，完全不同          |
 * | versus               | versus             | 一致                          |
 */
