export interface RankingUser {
    uid: number;
    name: string;
    introduction: string;
    rank: number;
    sid: number;
    strained: number;
    degrees: number[];
    // tier: number; 玩家信息无需存储tier，因为会变，所以只需要在points同一时间里是1~10排序顺序就能确定那一时刻的名次了
    // 另外，玩家信息以最新为准
}
// 从 Bandori 服务器获取并转化的 user 信息
export interface RankingUserRaw extends RankingUser {
    tier: number;
    point: number;
    // 还有一些字段我们抛弃了
}
