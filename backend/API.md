# API Documentation

## Quick Navigation

- [Base](#base)
- [GET `/api/scores`](#get-apiscores)
- [GET `/api/events`](#get-apievents)

## Base

- Local default host/port: `http://127.0.0.1:5519`
- Base path: `/api`
- Content-Type: `application/json`

## GET `/api/scores`

Query Bestdori ranking track data and return aligned score points by player UID.

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
GET /api/scores?server=0&event=321&interval=3600000&time=30
```

Incremental example:

```http
GET /api/scores?server=0&event=321&time=60&lastTimeStamp=1771394346326
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



