# API Documentation

## Quick Navigation

- [Base](#base)
- [GET `/api/topPoints`](#get-apitoppoints)
- [GET `/api/events`](#get-apievents)
- [GET `/api/songs`](#get-apisongs)
- [GET `/api/songMetadata.json`](#get-apisongmetadatajson)
- [GET `/api/monthlyRanking/info.json`](#get-apimonthlyrankinginfojson)
- [GET `/api/monthlyRanking/info.{monthlyRankingId}.json`](#get-apimonthlyrankinginfomonthlyrankingidjson)
- [GET `/api/monthlyRanking/top`](#get-apimonthlyrankingtop)
- [GET `/api/monthlyRanking/border`](#get-apimonthlyrankingborder)
- [GET `/api/playerDeckStatus`](#get-apiplayerdeckstatus)

## Base

- Local default host/port: `http://127.0.0.1:5519`
- Base path: `/api`
- Content-Type: `application/json`

## GET `/api/topPoints`

Query Bestdori ranking track data and return aligned points by player UID.

### Query Parameters

- `server` (`number`, required, enum: `0|1|2|3|4`)
  - `0=jp`, `1=en`, `2=tw`, `3=cn`, `4=kr`
- `event` (`number`, required, integer, `>= 1`)
- `interval` (`number`, optional, integer, `>= 1`, default `30000`)
- `time` (`number`, required, integer, `>= 2`) minutes window from newest timestamp
- `lastTimeStamp` (`number`, optional, integer, `>= 0`)
  - when provided, response only includes points with `time >= lastTimeStamp`

Example:

```http
GET /api/topPoints?server=0&event=321&interval=3600000&time=30
```

Incremental example:

```http
GET /api/topPoints?server=0&event=321&time=60&lastTimeStamp=1771394346326
```

Upstream mapping:

```text
https://bestdori.com/api/eventtop/data?server={server}&event={event}&mid=0&interval={interval}
```

### Success Response `200`

```json
[
  {
    "uid": 28012549,
    "points": [
      { "time": 1771394346326, "points": 97141027 },
      { "time": 1771394406326, "points": -1 }
    ],
    "info": {
      "name": "player-name",
      "introduction": "player-introduction"
    }
  }
]
```

### Response Contract

- Response is an array ordered by ranking (high to low).
- Ranking is based on each player's last recorded non-`-1` points in the window.
- All `points` arrays have the same length.
- All `points[*].time` are fully aligned in the same order.
- If a player is not in top-10 at timestamp `T`, the aligned item is `{ time: T, points: -1 }`.
- Time window keeps all valid timestamps in range; unchanged points are retained as repeated values.
- Timestamps where upstream `points` count is not exactly 10 are treated as invalid and removed.
- If `lastTimeStamp` is set, only aligned timestamps `>= lastTimeStamp` are returned.

### Error Responses

#### `422` Validation Failed

```json
{
  "status": 422,
  "message": "Validation Failed",
  "details": [
    {
      "message": "should bigger than 2",
      "code": "invalid",
      "field": "time"
    }
  ]
}
```

#### `502` Upstream Request Failed

```json
{
  "status": 502,
  "message": "Internal Server Error"
}
```

#### `504` Upstream Timeout

```json
{
  "status": 504,
  "message": "Internal Server Error"
}
```

#### `404` Route Not Found

```json
{
  "status": 404,
  "message": "Route Not Found: GET /api/xxx"
}
```

## GET `/api/events`

Query Bestdori event list and return a filtered object keyed by event ID.

### Query Parameters

- None

Example:

```http
GET /api/events
```

Upstream mapping:

```text
https://bestdori.com/api/events/all.5.json
```

### Success Response `200`

```json
{
  "297": {
    "eventType": "mission_live",
    "eventName": [
      "雨上がり、瞳に映る空は",
      "After Rain, The Sky Reflected in Eyes",
      "雨後，映照在眼中的天空",
      "雨过天晴，映入眼帘的天空",
      null
    ],
    "assetBundleName": "ammeagari_sora",
    "startAt": [
      "1749535200000",
      "1774918800000",
      "1766559600000",
      "1767934800000",
      null
    ],
    "endAt": [
      "1750247999000",
      "1775631599000",
      "1767272399000",
      "1768748399000",
      null
    ]
  }
}
```

### Response Contract

- Response is an object keyed by Bestdori event ID.
- Each event only includes `eventType`, `eventName`, `assetBundleName`, `startAt`, `endAt`.
- Unknown/missing scalar fields are normalized to `null`.
- Unknown/missing array fields are normalized to `[]`.

### Error Responses

- `422` is not applicable for this endpoint because no query parameters are validated.

#### `502` Upstream Request Failed

```json
{
  "status": 502,
  "message": "Internal Server Error"
}
```

#### `504` Upstream Timeout

```json
{
  "status": 504,
  "message": "Internal Server Error"
}
```

#### `404` Route Not Found

```json
{
  "status": 404,
  "message": "Route Not Found: GET /api/xxx"
}
```

## GET `/api/songs`

Query Bestdori song list and return the full music database keyed by song ID.

### Query Parameters

- None

Example:

```http
GET /api/songs
```

Upstream mapping:

```text
https://bestdori.com/api/songs/all.5.json
```

### Success Response `200`

```json
{
  "1": {
    "tag": "anime",
    "bandId": 1,
    "jacketImage": ["jacket001.png"],
    "musicTitle": ["Yes! BanG_Dream!", "Yes! BanG_Dream!", "Yes! BanG_Dream!", "Yes! BanG_Dream!", null],
    "publishedAt": ["1489420800000", "1522141200000", "1535662800000", "1556197200000", null],
    "closedAt": [null, null, null, null, null],
    "difficulty": {
      "0": { "playLevel": 5 },
      "1": { "playLevel": 10 },
      "2": { "playLevel": 16 },
      "3": { "playLevel": 24 },
      "4": { "playLevel": 27, "publishedAt": ["1489420800000", "1522141200000", "1535662800000", "1556197200000", null] }
    }
  }
}
```

### Response Contract

- Response is an object keyed by Bestdori song ID (string).
- Each song includes `tag` (anime / normal / tie_up), `bandId`, `jacketImage`, `musicTitle`, `publishedAt`, `closedAt`, and `difficulty`.
- `musicTitle`, `publishedAt`, `closedAt`, and `jacketImage` are arrays of 5 elements indexed by server (0=jp, 1=en, 2=tw, 3=cn, 4=kr). Elements may be `null`.
- `difficulty` keys: `"0"` (easy), `"1"` (normal), `"2"` (hard), `"3"` (expert), `"4"` (special). The `"4"` key may be absent if the song has no special difficulty.
- Each difficulty contains `playLevel` (integer) and optionally `publishedAt` (5-element server array).

### Error Responses

- `422` is not applicable for this endpoint because no query parameters are validated.

#### `502` Upstream Request Failed

```json
{
  "status": 502,
  "message": "Internal Server Error"
}
```

#### `504` Upstream Timeout

```json
{
  "status": 504,
  "message": "Internal Server Error"
}
```

#### `404` Route Not Found

```json
{
  "status": 404,
  "message": "Route Not Found: GET /api/xxx"
}
```

## GET `/api/songMetadata.json`

Return the cached Bestdori chart distribution dataset (`SongChartMeta`) keyed by `song_id` then `level`.

### Query Parameters

- None

Example:

```http
GET /api/songMetadata.json
```

Response is JSON and may be gzipped when the client sends `Accept-Encoding: gzip`.

### Success Response `200`

```json
{
  "1": {
    "22": {
      "total": 459,
      "counts": {
        "3.0": [11, 15, 16, 8, 9, 10]
      }
    }
  }
}
```

### Response Contract

- The dataset is stored under `backend/data/songMetadata.json` and reused until the configured check interval expires.
- Raw chart storage is disabled by default and can be enabled via `BESTDORI_STORE_RAW_CHARTS`.
- All available difficulties are fetched in upstream order (`easy`, `normal`, `hard`, `expert`, `special`) and stored as `{ [song_id]: { [level]: { total, counts } } }`.

## GET `/api/monthlyRanking/info.json`

Return the list of all monthly ranking periods with basic metadata.

This endpoint accepts both `/monthlyRanking/info` and `/monthlyRanking/info.json`. The data is served from the local cache and does not trigger an extra upstream fetch.

### Query Parameters

- None

Example:

```http
GET /api/monthlyRanking/info.json
```

### Success Response `200`

```json
{
  "21": {
    "monthlyRankingName": [
      "2026年6月度 月間ランキング",
      null,
      null,
      null,
      null
    ],
    "assetBundleName": "monthly_ranking_202606",
    "bgmFileName": "bgm_monthly_202606",
    "startAt": [
      1780293600000,
      null,
      null,
      null,
      null
    ],
    "endAt": [
      1782831599000,
      null,
      null,
      null,
      null
    ]
  }
}
```

### Response Contract

- Response is an object keyed by `monthlyRankingId` (string).
- Each entry includes `monthlyRankingName`, `assetBundleName`, `bgmFileName`, `startAt`, `endAt`.
- All array fields contain 5 elements indexed by server (0=jp, 1=en, 2=tw, 3=cn, 4=kr). Elements may be `null` when the monthly ranking is not active on that server.

### Error Responses

- `422` is not applicable for this endpoint because no query parameters are validated.

#### `404` Route Not Found

```json
{
  "status": 404,
  "message": "Route Not Found: GET /api/xxx"
}
```

## GET `/api/monthlyRanking/info.{monthlyRankingId}.json`

Return the detailed metadata for a single monthly ranking period.

This endpoint reuses the same cached monthly ranking information used by `/api/monthlyRanking/info.json`; it does not trigger an extra upstream fetch. The stored document contains the full detail payload, and the simpler info fields are derived from it.

### Query Parameters

- `monthlyRankingId` (`number`, required, integer, `>= 1`)

Example:

```http
GET /api/monthlyRanking/info.21.json
```

### Success Response `200`

```json
{
  "monthlyRankingId": 21,
  "monthlyRankingName": [
    "2026年6月度 月間ランキング",
    null,
    null,
    null,
    null
  ],
  "assetBundleName": "monthly_ranking_202606",
  "bgmFileName": "bgm_monthly_202606",
  "startAt": [
    1780293600000,
    null,
    null,
    null,
    null
  ],
  "endAt": [
    1782831599000,
    null,
    null,
    null,
    null
  ],
  "enableFlag": [
    true,
    null,
    null,
    null,
    null
  ],
  "publicStartAt": [
    1780293600000,
    null,
    null,
    null,
    null
  ],
  "publicEndAt": [
    1782885599000,
    null,
    null,
    null,
    null
  ],
  "distributionStartAt": [
    1782874800000,
    null,
    null,
    null,
    null
  ],
  "distributionEndAt": [
    1784084400000,
    null,
    null,
    null,
    null
  ],
  "aggregateEndAt": [
    1782833399000,
    null,
    null,
    null,
    null
  ],
  "receptionEndAt": [
    1782832199000,
    null,
    null,
    null,
    null
  ],
    "rewards": [
        [
            {
                "id": 1181,
                "monthlyRankingId": 21,
                "fromRank": 1,
                "toRank": 1,
                "rewardType": "degree",
                "rewardId": 9696,
                "rewardQuantity": 1
            }
        ],
        null, null, null],
    "grades": [
        [
            {
                "id": 189,
                "monthlyRankingId": 21,
                "gradeAheadType": "GOLD_TO_PLATINUM",
                "pt": 5000,
                "rewardType": "limit_break_item",
                "rewardId": 2,
                "rewardQuantity": 1,
                "rankingThresholdFlg": false
            }
        ],
        null, null, null]
}
```

### Response Contract

- Returns one monthly ranking detail record keyed by the requested `monthlyRankingId`.
- The response includes the full stored detail payload, not the list-style summary.
- If the requested ID is not present in the local cache, the endpoint returns `404`.

### Error Responses

#### `422` Validation Failed

```json
{
  "status": 422,
  "message": "Validation Failed",
  "details": [
    {
      "message": "should bigger than 1",
      "code": "invalid",
      "field": "monthlyRankingId"
    }
  ]
}
```

#### `404` Monthly Ranking Not Found

```json
{
  "status": 404,
  "message": "Monthly ranking detail not found: 123"
}
```

## GET `/api/monthlyRanking/top`

Fetch a snapshot of the current monthly ranking top player points for a given server.

This endpoint accepts both `/monthlyRanking/top` and `/monthlyRanking/top.json`.

### Query Parameters

- `server` (`number`, required, integer, `>= 0`, max depends on configured server count)
- `monthlyId` (`number`, optional, integer, `>= 1`)
  - when omitted, the current active monthly ranking ID is auto-resolved

Example:

```http
GET /api/monthlyRanking/top?server=0
```

Explicit monthly ID:

```http
GET /api/monthlyRanking/top?server=0&monthlyId=21
```

### Success Response `200`

```json
{
  "points": [
    { "timestamp": 1780293600000, "uid": 111798074, "value": 6890100 }
  ],
  "users": [
    {
      "uid": 111798074,
      "name": "player-name",
      "introduction": "",
      "rank": 1,
      "sid": 23,
      "strained": 0,
      "degrees": [9696]
    }
  ]
}
```

### Response Contract

- `points` is an array of `{ timestamp, uid, value }` records sorted by timestamp.
- `users` is an array of player profiles keyed by `uid`, with `name`, `introduction`, `rank`, `sid`, `strained`, and `degrees`.
- Player info in `users` reflects the latest known state and is not timestamped.
- When no active monthly ranking exists for the requested server, returns `{ points: [], users: [] }`.

### Error Responses

#### `422` Validation Failed

```json
{
  "status": 422,
  "message": "Validation Failed",
  "details": [
    {
      "message": "server must be between 0 and 0",
      "code": "invalid",
      "field": "server"
    }
  ]
}
```

#### `404` Route Not Found

```json
{
  "status": 404,
  "message": "Route Not Found: GET /api/xxx"
}
```

## GET `/api/monthlyRanking/border`

Fetch the latest border/cutoff points for a given server and tier.

This endpoint accepts both `/monthlyRanking/border` and `/monthlyRanking/border.json`.

### Query Parameters

- `server` (`number`, required, integer, `>= 0`, max depends on configured server count)
- `tier` (`number`, required, integer, enum: `20|30|40|50|100|200|300|500|1000|2000|3000|4000|5000`)
- `monthlyId` (`number`, optional, integer, `>= 1`)
  - when omitted, the current active monthly ranking ID is auto-resolved

Example:

```http
GET /api/monthlyRanking/border?server=0&tier=100
```

Explicit monthly ID:

```http
GET /api/monthlyRanking/border?server=0&tier=100&monthlyId=21
```

### Success Response `200`

```json
{
  "result": true,
  "cutoffs": [
    { "time": 1780293600000, "ep": 5000 }
  ]
}
```

### Response Contract

- `cutoffs` is an array of `{ time, ep }` records where `time` is a Unix timestamp (ms) and `ep` is the event-point cutoff value for the requested tier.
- `result` is always `true` when data is available.
- When no active monthly ranking exists for the requested server, returns `{ result: true, cutoffs: [] }`.

### Error Responses

#### `422` Validation Failed

```json
{
  "status": 422,
  "message": "Validation Failed",
  "details": [
    {
      "message": "tier must be one of: 20,30,40,50,100,200,300,500,1000,2000,3000,4000,5000",
      "code": "invalid",
      "field": "tier"
    }
  ]
}
```

#### `404` Route Not Found

```json
{
  "status": 404,
  "message": "Route Not Found: GET /api/xxx"
}
```

## GET `/api/playerDeckStatus`

Fetch a player's deck status from the game server, including computed stats, event bonuses, and skill information.

This endpoint queries the Bestdori API for player profile, cards, area items, skills, and events, then computes normalized power values and skill data for the player's current main deck.

### Query Parameters

- `server` (`number`, required, enum: `0|1|2|3|4`)
  - `0=jp`, `1=en`, `2=tw`, `3=cn`, `4=kr`
- `playerId` (`number`, required, integer, `>= 1`)
- `eventId` (`number`, optional, integer, `>= 1`)
  - when omitted or `0`, the current active event for the given server is auto-resolved

Example (auto-detect event):

```http
GET /api/playerDeckStatus?server=0&playerId=28012549
```

Example (explicit event):

```http
GET /api/playerDeckStatus?server=0&playerId=28012549&eventId=321
```

### Success Response `200`

```json
{
  "eventType": "mission_live",
  "eventName": "雨上がり、瞳に映る空は",
  "eventId": 297,
  "publishTotalDeckPowerFlg": true,
  "normalPower": 320000,
  "eventPower": 380000,
  "autoPower": 320000,
  "eventBonusPct": 150,
  "skills": [
    {
      "bonusPercent": 110,
      "durationSeconds": 5.5,
      "progressive": null
    },
    {
      "bonusPercent": 115,
      "durationSeconds": 5.0,
      "progressive": { "stepRate": 0.5, "maxCap": 150 }
    },
    {
      "bonusPercent": 130,
      "durationSeconds": 5.5,
      "progressive": null
    },
    {
      "bonusPercent": 100,
      "durationSeconds": 5.5,
      "progressive": null
    },
    {
      "bonusPercent": 110,
      "durationSeconds": 5.5,
      "progressive": null
    },
    {
      "bonusPercent": 115,
      "durationSeconds": 5.5,
      "progressive": null
    }
  ]
}
```

### Response Contract

- `eventType`: one of `mission_live`, `live_try`, `challenge`, `versus`, `festival` (5v5), `medley`, or `none` when no event is active.
- `eventName`: localized event name (falls back to Japanese if the server-specific name is unavailable).
- `eventId`: the resolved Bestdori event ID, or `null` when no event is active.
- `publishTotalDeckPowerFlg`: whether the player has made their total deck power public.
- `normalPower`: base total deck power including area item bonuses (integer, floored).
- `eventPower`: total deck power with event character/attribute/member/limit-break bonuses applied (integer, floored). For `mission_live` and `live_try`, event bonus is not added to power.
- `autoPower`: total deck power used for auto-play score calculations. For challenge events this equals normal power; for versus/festival/medley this equals event power; for other types this equals normal power.
- `eventBonusPct`: summed event-point bonus percentage across all 5 cards (integer, rounded).
- `skills`: array of 6 skill objects. The first 5 entries (index 0–4) are reordered to match the frontend UI layout (member3 → member1 → leader → member2 → member4). The 6th entry (index 5) is the center/captain skill. Each skill object contains:
  - `bonusPercent`: the score-up percentage (integer, raw value from Bestdori, e.g. `110` = 110%). For unification-type skills where all deck members satisfy the condition, the higher unification value is returned.
  - `durationSeconds`: skill duration in seconds (float with 1 decimal place).
  - `progressive`: progressive/stack skill info — `null` for normal skills, or `{ stepRate, maxCap }` where values are raw Bestdori percentages (e.g. `stepRate: 0.5` = 0.5% step, `maxCap: 150` = 150% cap).

### Error Responses

#### `422` Validation Failed

```json
{
  "status": 422,
  "message": "Validation Failed",
  "details": [
    {
      "message": "should bigger than 1",
      "code": "invalid",
      "field": "playerId"
    }
  ]
}
```

#### `500` Internal Server Error

```json
{
  "status": 500,
  "message": "Player deck is empty"
}
```
