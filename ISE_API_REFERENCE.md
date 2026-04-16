# Cisco ISE 3.4 REST API Reference

Intern reference-dokument for dette projekt. Opdateres løbende med lærte ting.
Officielle docs: `https://<ise>/api/swagger-ui/index.html` (Open API) og `https://<ise>:9060/ers/sdk` (ERS SDK).

---

## To API-overflader

| | ERS (legacy) | Open API (ISE 3.1+) |
|---|---|---|
| **Base URL** | `https://<ise>:443/ers/config/...` (eller port 9060) | `https://<ise>:443/api/v1/...` |
| **Enabled** | Manuelt: Administration → System → Settings → API Settings → Enable ERS | **Default i ISE 3.4** |
| **Auth** | Basic (kræver ERS Admin rolle) | Basic (OAuth planlagt men ikke default) |
| **Headers** | `Accept: application/json`, `Content-Type: application/json` | Samme |
| **Docs** | ERS SDK: `https://<ise>:9060/ers/sdk` | Swagger UI: `https://<ise>/api/swagger-ui/index.html` |
| **Status** | Stabil, men legacy — nye features kommer kun i Open API | Anbefalet vej fremad |

Siden ISE 3.1 router **API gateway** alle tre API-typer (ERS, Open API, MnT) over port 443.

---

## ERS — Endpoint resources

### Paths

| Resource | Path | Metoder |
|---|---|---|
| Endpoint | `/ers/config/endpoint` | GET (list), POST (create) |
| Endpoint by ID | `/ers/config/endpoint/{id}` | GET, PUT, DELETE |
| Endpoint by name/MAC | `/ers/config/endpoint/name/{mac}` | GET |
| Endpoint Group | `/ers/config/endpointgroup` | GET (list) |
| Endpoint Group by name | `/ers/config/endpointgroup/name/{name}` | GET |
| Security Group Tag | `/ers/config/sgt` | GET (list) |
| ANC Apply | `/ers/config/ancendpoint/apply` | POST |
| ANC Clear | `/ers/config/ancendpoint/clear` | POST |

### Pagination & filtrering

```
GET /ers/config/endpoint?page=1&size=100&filter=mac.CONTAINS.AA:BB
```

- `page` — 1-baseret sidetal
- `size` — max 100 per side
- `filter` — kan gentages for AND-logik. Format: `<felt>.<operator>.<værdi>`

**Filter-operatorer**: `EQ`, `NEQ`, `CONTAINS`, `STARTSW`, `ENDSW`, `GT`, `LT`

**Filtrerbare felter**: `mac`, `name`, `description`, `groupId`, `profileId`, `portalUser`, `staticGroupAssignment`

### GET list — response

```json
{
  "SearchResult": {
    "total": 247,
    "resources": [
      {
        "id": "abc-123-def",
        "name": "AA:BB:CC:DD:EE:FF",
        "description": "Lab printer",
        "link": {
          "rel": "self",
          "href": "https://ise:9060/ers/config/endpoint/abc-123-def",
          "type": "application/json"
        }
      }
    ]
  }
}
```

**Vigtigt**: Listen returnerer kun `id`, `name`, `description` og `link`. For at se `groupId`, `profileId`, `customAttributes` m.m. skal man lave en individuel `GET /ers/config/endpoint/{id}`.

### GET by ID — response

```json
{
  "ERSEndPoint": {
    "id": "abc-123-def",
    "name": "AA:BB:CC:DD:EE:FF",
    "description": "Lab printer",
    "mac": "AA:BB:CC:DD:EE:FF",
    "groupId": "group-uuid",
    "staticGroupAssignment": true,
    "staticProfileAssignment": false,
    "profileId": "profile-uuid",
    "portalUser": "",
    "identityStore": "",
    "identityStoreId": "",
    "customAttributes": {
      "customAttributes": {
        "Location": "BLR-1F",
        "Owner": "Facilities"
      }
    },
    "link": { "rel": "self", "href": "...", "type": "application/json" }
  }
}
```

### POST create

```
POST /ers/config/endpoint
```

```json
{
  "ERSEndPoint": {
    "name": "camera-01",
    "mac": "AA:BB:CC:11:22:33",
    "description": "Lobby Cam",
    "staticGroupAssignment": true,
    "groupId": "<UUID>",
    "securityGroupId": "<SGT-UUID>",
    "profileId": "<profile-UUID>",
    "customAttributes": {
      "customAttributes": {
        "Location": "BLR-1F",
        "Owner": "Facilities"
      }
    }
  }
}
```

**Response**: `201 Created`
- `Location` header: `https://ise:9060/ers/config/endpoint/<new-uuid>` — **parse dette for at hente ID uden ekstra GET**

**Vigtige felter**:
- `staticGroupAssignment: true` er **påkrævet** for at `groupId` holder. Uden det re-profiler ISE endpointet og overskriver gruppetildelingen.
- `customAttributes` er **double-nested**: `{ customAttributes: { customAttributes: { key: val } } }`
- `name` er normalt lig `mac` men behøver det ikke

### PUT update

```
PUT /ers/config/endpoint/{id}
```

```json
{
  "ERSEndPoint": {
    "id": "<uuid>",
    "description": "Updated description",
    "groupId": "<new-group-uuid>",
    "staticGroupAssignment": true
  }
}
```

Send kun de felter der skal ændres (plus `id`). **Response**: `200 OK`.

### DELETE

```
DELETE /ers/config/endpoint/{id}
```

**Response**: `204 No Content`.

---

## Bulk-operationer

> ISE har **ingen bulk-endpoints** — hverken for create, update eller delete. Man SKAL loope client-side.

**Throttling**: Cisco anbefaler max 5–10 requests/sekund. Ved store imports (>50 endpoints):
- Tilføj `asyncio.sleep(0.1)` mellem hvert kald, eller
- Brug en semaphore med max 5 samtidige requests

**409 Conflict** er det forventede svar ved forsøg på at oprette et endpoint der allerede eksisterer (MAC collision). Behandl dette som "skipped" i bulk-imports, ikke som en fejl.

---

## Endpoint Groups

### GET list

```
GET /ers/config/endpointgroup?size=100
```

Response: samme `SearchResult` format som endpoints.

### GET by name

```
GET /ers/config/endpointgroup/name/{groupName}
```

```json
{
  "EndPointGroup": {
    "id": "group-uuid",
    "name": "Unknown",
    "description": "Default group for unregistered endpoints",
    "systemDefined": true
  }
}
```

---

## ANC (Adaptive Network Control) Quarantine

### Apply

```
POST /ers/config/ancendpoint/apply
```
```json
{ "OperationAdditionalData": { "additionalData": [
  { "name": "macAddress", "value": "AA:BB:CC:11:22:33" },
  { "name": "policyName", "value": "QUARANTINE" }
]}}
```

### Clear

```
POST /ers/config/ancendpoint/clear
```
```json
{ "OperationAdditionalData": { "additionalData": [
  { "name": "macAddress", "value": "AA:BB:CC:11:22:33" }
]}}
```

---

## Open API — `/api/v1/endpoint`

Open API er den strategiske vej for ISE 3.4+. Payload- og response-shapes afviger fra ERS.

| Metode | Path | Bemærkninger |
|---|---|---|
| GET | `/api/v1/endpoint` | Liste med filter, sort, paging |
| GET | `/api/v1/endpoint/{id}` | Individuel |
| POST | `/api/v1/endpoint` | Opret |
| PUT | `/api/v1/endpoint/{id}` | Opdater |
| DELETE | `/api/v1/endpoint/{id}` | Slet |

Swagger UI på `https://<ise>/api/swagger-ui/index.html` har den fulde spec for din ISE-version.

**Vigtige forskelle fra ERS**:
- Ingen `ERSEndPoint` wrapper — flat JSON
- Felter har andre navne (f.eks. `identityGroupId` i stedet for `groupId`)
- Filtrering via standard query params, ikke ERS `filter=` syntax
- OpenAPI JSON-specifikation kan downloades fra ISE GUI → API Settings og bruges til auto-generering af client-kode

---

## Status codes

| Code | Betydning | Håndtering |
|---|---|---|
| 200 | OK (GET, PUT) | parse body |
| 201 | Created (POST) | parse `Location` header for ID |
| 204 | No Content (DELETE) | ingen body |
| 400 | Bad request | tjek payload format |
| 401 | Unauthorized | forkert credentials ELLER ERS ikke enabled ELLER bruger mangler ERS Admin rolle |
| 404 | Not found | endpoint/gruppe ID eksisterer ikke |
| 409 | Conflict | endpoint med denne MAC eksisterer allerede |
| 415 | Unsupported Media Type | tjek `Content-Type` og `Accept` headers |
| 422 | Unprocessable Entity | schema validering fejlede |
| 429 | Rate limited | for mange requests — implementer throttling |
| 500 | ISE intern fejl | retry efter pause |

## Error response format (ERS)

```json
{
  "ERSResponse": {
    "operation": "POST-create-endpoint",
    "messages": [
      {
        "title": "Endpoint already exists",
        "type": "ERROR",
        "code": "duplicate.error"
      }
    ]
  }
}
```

Parse `ERSResponse.messages[0].title` for brugervenlig fejlbesked.

---

## Gotchas & tips

1. **`staticGroupAssignment: true`** — uden dette holder gruppetildelingen ikke; ISE re-profiler endpointet.
2. **Double-nested custom attributes** — `{ customAttributes: { customAttributes: { ... } } }` — mærkelig, men det er ERS.
3. **ERS list returnerer kun id+name+link** — for alle andre felter (groupId, description, profileId, customAttributes) skal du GET individuelt.
4. **MAC format** — ISE accepterer `AA:BB:CC:DD:EE:FF` og `AA-BB-CC-DD-EE-FF`. Normér altid til kolon-separeret uppercase.
5. **Port 9060 vs 443** — begge virker. Siden ISE 3.1 anbefales 443 via API gateway.
6. **ERS SDK** — `https://<ise>:9060/ers/sdk` giver auto-genereret doku med schema-filer, Java/Python eksempler, og cURL use cases. Kun tilgængelig for ERS Admin.
7. **Swagger UI** — `https://<ise>/api/swagger-ui/index.html` for Open API interactive docs.
