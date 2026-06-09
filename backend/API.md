# API Documentation

## Quick Navigation

- [Base](#base)
- [GET `/api/topPoints`](#get-apitoppoints)
- [GET `/api/events`](#get-apievents)
- [GET `/api/monthlyRanking/info.{monthlyRankingId}.json`](#get-apimonthlyrankinginfomonthlyrankingidjson)
- [GET `/api/songMetadata.json`](#get-apisongmetadatajson)

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


