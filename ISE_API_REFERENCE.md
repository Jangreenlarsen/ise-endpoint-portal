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

### Node-routing i portalen (læs/skriv-split, v6.31.0740)

ERS + Open API (config-REST) serveres af **Admin-personaen** — der findes ingen "REST-only"-node. Men en Secondary PAN har en fuld read-replika af config-DB'en, så **GET** kan serveres derfra:

- `ise_base_url` (Primary PAN) — autoritativ. **Al skrivning** (POST/PUT/DELETE) går hertil.
- `ise_read_base_url` (valgfri, Secondary PAN) — når sat routes **GET** hertil for at aflaste Primary. Fejler/CB-open'er den, **auto-fallback** til Primary.
- Routing er ren HTTP-metode: GET → read-host, alt andet → Primary. (POST-baserede "læse"-kald, hvis nogen, går derfor til Primary — altid sikkert.)
- pxGrid (`pxgrid_psn_fqdn`) og MnT/CoA (`coa_psn_name`) har allerede egne node-targets.

> ⚠️ **GOTCHA (empirisk bekræftet, ise2/ise3-deployment 2026-07-10): en Secondary PAN serverer ikke nødvendigvis ERS.**
> "Read-replika ⇒ GET virker på Secondary PAN" er teorien, men i praksis **hang ERS fuldstændigt** på den sekundære PAN (`ise3`): TCP forbandt, men `GET /ers/config/endpointgroup` svarede aldrig → ReadTimeout med `idle_before=0s`. Samme kald mod Primary PAN (`ise2`) svarede øjeblikkeligt. Symptom i portalen: **tom endpoint-cache** når hoved-hosten pegede på den sekundære.
> **Regel: verificér ALTID en Secondary PAN's ERS med `curl` FØR den sættes som `ise_read_base_url`:**
> ```
> curl -k -m 35 -u '<ers-user>:<pw>' -H 'Accept: application/json' \
>   'https://<sec-pan>/ers/config/endpointgroup?size=1&page=1'
> ```
> Får du `{"SearchResult":...}` → OK som læse-host. Hænger den → **brug den ikke**; kør single-host mod Primary PAN. ERS serveres pålideligt kun af Primary PAN i mange ISE-versioner/deployments.
> Portalens auto-fallback (læse-fejl → Primary) beskytter mod nedbrud, men en hængende læse-host betyder at hvert read spilder én timeout før fallback — så en ikke-svarende Secondary skal udelades helt, ikke bare tolereres.

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

**Filtrerbare felter** (empirisk bekræftet på ISE 3.4, build 0033):
- ✅ `mac` — virker med alle operatorer
- ❌ `name` — ISE returnerer `400 The filter field 'name' is not supported` (selvom SDK-docs angiver det)
- ❌ `description` — ISE returnerer `400 The filter field 'description' is not supported`
- `groupId`, `profileId`, `portalUser`, `staticGroupAssignment` — ikke verificeret, men kræver UUIDs

Konklusion: Server-side filtrering er i praksis begrænset til `mac.*`. Alle andre felter skal filtreres client-side efter at have hentet endpoints (via `GET /endpoints/details/all`).

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

## Open API — RADIUS Policy Sets og Authorization Rules

Tilføjet i 5.0.0. Kræver Open API aktiveret i ISE.

### Paths

| Metode | Path | Bemærkninger |
|---|---|---|
| GET | `/api/v1/policy/network-access/policy-set` | Liste alle policy sets |
| GET | `/api/v1/policy/network-access/policy-set/{id}` | Enkelt policy set |
| GET | `/api/v1/policy/network-access/policy-set/{id}/authorization` | Liste auth regler (sorteret efter rank) |
| POST | `/api/v1/policy/network-access/policy-set/{id}/authorization` | Opret auth regel |
| PUT | `/api/v1/policy/network-access/policy-set/{id}/authorization/{ruleId}` | Opdater auth regel |
| DELETE | `/api/v1/policy/network-access/policy-set/{id}/authorization/{ruleId}` | Slet auth regel |

### Response envelope

```json
{ "response": [...], "version": "1.0.0" }
```

`response` er altid en liste, selv for enkelt-ressource GET.

### Policy set objekt

```json
{
  "id": "uuid",
  "name": "MAC ByPass",
  "rank": 0,
  "state": "enabled",
  "serviceName": "MACByPass_HOSTLOOKUP",
  "condition": { "conditionType": "ConditionReference", "name": "Wireless_MAB", ... }
}
```

### Authorization rule objekt

```json
{
  "id": "uuid",
  "name": "SSID 802 PSK Mode",
  "rank": 0,
  "state": "enabled",
  "profile": ["Endpoint_AirSpaceACL", "PermitAccess"],
  "condition": { "conditionType": "ConditionAndBlock", "children": [...] },
  "securityGroup": null
}
```

### Condition typer

| conditionType | Beskrivelse |
|---|---|
| `ConditionAttributes` | Enkelt attribut-tjek: `dictionaryName`, `attributeName`, `operator`, `attributeValue` |
| `ConditionAndBlock` | Alle `children` skal matche |
| `ConditionOrBlock` | Mindst ét barn skal matche |
| `ConditionReference` | Reference til navngivet condition-bibliotek — kun `id` + `name` tilgængeligt via API |

**Operators**: `equals`, `notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`, `matches` (regex)

**Dictionaries (empirisk)**:
- `EndPoints` — custom endpoint-attributter (Owner, Type, Lokation, PSK_Mode, m.fl.)
- `IdentityGroup` — attribut `Name` matcher identity group path, fx `Endpoint Identity Groups:Profiled:ADM-Apple-iPhone`
  - **GOTCHA**: Brug altid fuld sti med præfiks `Endpoint Identity Groups:`. `equals Endpoint Identity Groups:Profiled` matcher hierarkisk (Profiled + alle undergrupper). `equals Profiled` (uden præfiks) matcher aldrig noget — ISE gemmer altid fuld sti internt.
- `Radius` — RADIUS-protokolfelter (Called-Station-ID, NAS-Port-Type, m.fl.) — kun tilgængelige ved live session
- `Network`, `Device`, `NetworkAccess` — netværksenheds- og sessionskontekst

### POST payload (opret regel)

```json
{
  "rule": {
    "name": "Min regel",
    "rank": 0,
    "state": "enabled",
    "condition": {
      "conditionType": "ConditionAndBlock",
      "isNegate": false,
      "children": [
        {
          "conditionType": "ConditionAttributes",
          "isNegate": false,
          "dictionaryName": "EndPoints",
          "attributeName": "Owner",
          "operator": "equals",
          "attributeValue": "IT"
        }
      ]
    }
  },
  "profile": ["PermitAccess"],
  "securityGroup": null
}
```

Response: `200 OK` med oprettet regel i `response[0]`.

### Gotchas

- **Open API skal være aktiveret**: Administration → System → Settings → API Settings → Enable Open API.
- **`response` wrapper**: Altid en liste — brug `data["response"][0]` for enkelt-ressource.
- **Rank**: Lavere tal = højere prioritet. Default-reglen (ingen betingelse) er typisk højest rangerede.
- **ConditionReference kan ikke oprettes via API** — references peger på ISE's condition-bibliotek der kun kan redigeres via GUI. Portalen kan læse dem (navn synligt), men ikke expandere til fulde betingelser.
- **`profile` vs `profiles`**: Feltet hedder `profile` (ikke `profiles`) i ISE response — portalen normaliserer dette.

---

## ERS — Authorization Profiles

### Path

```
GET  /ers/config/authorizationprofile
GET  /ers/config/authorizationprofile/{id}
GET  /ers/config/authorizationprofile/name/{name}
POST /ers/config/authorizationprofile
PUT  /ers/config/authorizationprofile/{id}
```

**OBS**: `GET /ers/config/authorizationprofile` (list) returnerer transport error (TCP RST) i visse ISE 3.4 builds. Brug Open API fallback:
`GET /api/v1/policy/network-access/authorization-profiles` — returnerer `{ "response": [...] }`.

### POST payload — wrapper

```json
{ "AuthorizationProfile": { ... } }
```

### Common task felter

| Felt | Formål | Dynamisk dict-reference |
|---|---|---|
| `daclName` | Downloadable ACL | **Ja** — `"EndPoints:AuthzACL"` virker |
| `vlan.nameID` | VLAN-navn/-ID | **Nej** — kun statisk eller ODBC dictionary |
| `vlan.tagID` | RADIUS tunnel-tag (1–31) | N/A |

**Vigtigt**: `vlan.nameID = "EndPoints:AuthzVlan"` giver `500: EndPoints is not a valid ODBC dictionary. Only ODBC dictionaries are allowed in Common tasks.` Brug i stedet `advancedAttributes` med `Radius:Tunnel-Private-Group-ID` for dynamisk VLAN.

### advancedAttributes — feltnavn-typos (ISE API)

ISE ERS har konsekvente typos i `advancedAttributes`-felterne — mangler `t` i "Attribu**t**e":

| Korrekt navn (ISE-typo) | Forventet navn |
|---|---|
| `leftHandSideDictionary**Attribue**` | leftHandSideDictionaryAttribute |
| `rightHandSideAttribu**e**Value` | rightHandSideAttributeValue |

**Brug præcis disse navne med typoen** — ISE afviser `rightHandSideAttribValue` (400 JSON invalidity).

### advancedAttributes — struktur

```json
"advancedAttributes": [
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "<dict>",
      "attributeName": "<attr>"
    },
    "rightHandSideAttribueValue": {
      "AdvancedAttributeValueType": "AttributeValue",
      "value": "<static-value>"
    }
  },
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "<dict>",
      "attributeName": "<attr>"
    },
    "rightHandSideAttribueValue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "<dict>",
      "attributeName": "<attr>"
    }
  }
]
```

### Kendte RADIUS dictionary-navne (empirisk bekræftet ISE 3.4)

| Dictionary | Attributter | Bemærkning |
|---|---|---|
| `Cisco` | `cisco-av-pair` | Cisco VSA / AV-pairs. **Ikke** `Cisco-AV-Pair`. |
| `Radius` | `Tunnel-Type`, `Tunnel-Medium-Type`, `Tunnel-Private-Group-ID`, m.fl. | Standard RADIUS RFC-attributter |
| `Airespace` | `Airespace-ACL-Name` | Cisco WLC / Airespace ACL |
| `EndPoints` | Custom endpoint-attributter (`AuthzVlan`, `AuthzACL`, `PSK_Key`, …) | Dynamisk reference i `rightHandSideAttribueValue` |

### Tunnel-attributter med tag (VLAN-profiler)

Til dynamisk VLAN-tildeling fra endpoint-attribut:

```json
"advancedAttributes": [
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "Radius", "attributeName": "Tunnel-Type"
    },
    "rightHandSideAttribueValue": { "AdvancedAttributeValueType": "AttributeValue", "value": "1:13" }
  },
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "Radius", "attributeName": "Tunnel-Medium-Type"
    },
    "rightHandSideAttribueValue": { "AdvancedAttributeValueType": "AttributeValue", "value": "1:6" }
  },
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "Radius", "attributeName": "Tunnel-Private-Group-ID"
    },
    "rightHandSideAttribueValue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "EndPoints", "attributeName": "AuthzVlan"
    }
  }
]
```

Formatet `"1:13"` = RADIUS tunnel-tag 1 + værdi 13 (VLAN). `"1:6"` = tag 1 + 802 (IEEE-802 medium type).

### cisco-av-pair (PSK)

```json
"advancedAttributes": [
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "Cisco", "attributeName": "cisco-av-pair"
    },
    "rightHandSideAttribueValue": { "AdvancedAttributeValueType": "AttributeValue", "value": "psk-mode=ascii" }
  },
  {
    "leftHandSideDictionaryAttribue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "Cisco", "attributeName": "cisco-av-pair"
    },
    "rightHandSideAttribueValue": {
      "AdvancedAttributeValueType": "AdvancedDictionaryAttribute",
      "dictionaryName": "EndPoints", "attributeName": "PSK_Key"
    }
  }
]
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

## Custom Endpoint Attributes

Custom endpoint attributes er brugerdefinerede felter der kan knyttes til hvert endpoint. ISE håndhæver **ingen allowed values** — de er free-text String-felter. Portalen holder sine egne tilladte værdier lokalt i `backend/custom_attr_values.json`.

### Vigtig begrænsning

> **ERS API har INGEN sti til at oprette/administrere custom attribute *definitioner*.** Stien `/ers/config/endpointcustomattribute` returnerer **404**.
>
> Definitioner skal oprettes via **Open API** (`/api/v1/endpoint-custom-attribute`) eller manuelt i ISE GUI:
> **Administration → Identity Management → Settings → Endpoint Custom Attributes**

### Open API — definitioner (ISE 3.1+)

```
GET  /api/v1/endpoint-custom-attribute          — list definitions
POST /api/v1/endpoint-custom-attribute          — create definition
```

**Forudsætning**: Open API skal være aktiveret i ISE: **Administration → System → Settings → API Settings → Enable Open API**

**POST payload** (flat JSON, ingen wrapper):
```json
{
  "attributeName": "Owner",
  "attributeType": "String"
}
```

**Response**: `201 Created`. Attribut der allerede eksisterer giver `400`.

### Manuel oprettelse (ISE GUI)

1. Log ind på ISE Admin
2. Navigér til **Administration → Identity Management → Settings → Endpoint Custom Attributes**
3. Klik **+**
4. Indtast attribut-navn (f.eks. `Owner`) og vælg type `String`
5. Gentag for `Location` og `AuthzVlan`

### Brug i endpoints

Custom attributes sættes ved endpoint create/update via den double-nested struktur:

```json
{
  "ERSEndPoint": {
    "customAttributes": {
      "customAttributes": {
        "Owner": "IT",
        "Location": "BLR-1F",
        "AuthzVlan": "VLAN100"
      }
    }
  }
}
```

Kun attributter med en ikke-tom værdi sendes. Tomme strenge udelades.

---

## MnT — Change of Authorization (CoA)

MnT (Monitoring & Troubleshooting) eksponerer et separat API-surface til at
udløse CoA på aktive sessions. Dette bruges i portalen til at tvinge
reauth efter endpoint-ændringer så attribut-ændringer slår igennem uden at
brugeren skal genforbinde.

### Paths

```
GET /admin/API/mnt/CoA/Reauth/{psnName}/{macAddress}/{reauthType}
GET /admin/API/mnt/CoA/Disconnect/{psnName}/{macAddress}/{disconnectType}
```

- `psnName` — hostnavn på den PSN der skal **udstede** CoA'en. Bemærk: CoA-pakken
  originerer fra PSN'ens RADIUS-persona mod NAD'en (switch/WLC) på UDP 1700/3799 —
  **ISE modtager ikke en CoA**. HTTP-kaldet går til MnT-noden; `psnName` navngiver
  kun udstederen.
  > ⚠️ I en **standalone** node er MnT og PSN samme host, og "brug MnT-hosten" virker.
  > I en **distribueret** opsætning gør det ikke: PAN'en kører typisk ikke
  > PSN-personaen, så en CoA navngivet med PAN-hostnavnet sendes aldrig. NAD'en vil
  > desuden kun acceptere en CoA fra en kilde den har som RADIUS-server med matchende
  > shared secret. Sæt `coa_psn_name` til den PSN der faktisk holder sessionen.
- `macAddress` — kolon-separeret upper-case (`AA:BB:CC:DD:EE:FF`)
- `reauthType` — `0` = DEFAULT, `1` = RERUN, `2` = LAST
  - **RERUN** (1) er standard ved attribut-ændringer: ISE genvurderer hele
    policy-sættet fra bunden.

### Auth og response

- Basic auth. **Vigtigt:** MnT REST API kræver rollen `MnT Admin` eller `Super Admin`
  — `ERS Admin` alene giver 401 Unauthorized (HTML login-side). ERS og MnT er
  separate admin-grupper i ISE RBAC. Tildel rollen i ISE under
  *Administration → System → Admin Access → Administrators → Admin Users*.
- `Accept: application/xml` — response er XML, **ikke JSON**.
- Status 200 + XML-payload med status-tag (f.eks. `<remoteCoA><results>...</results></remoteCoA>`).
- 401/403 ved manglende rettigheder (typisk manglende MnT Admin-rolle);
  5xx hvis sessionen ikke findes eller MnT er nede.

### Gotchas

- Kræver at endpointet har en aktiv session — ellers fejler CoA'en.
- Hvis `psnName` ikke matcher hostname på sessionens PSN, kan CoA afvises.
- 401 med HTML-body (`<html>...login.jsp...`) betyder næsten altid manglende
  MnT Admin-rolle, ikke forkert password.
- PxGrid er alternativ for store deployments, men MnT-pathen er simpler at integrere og ikke certifikat-afhængig.

---

## Gotchas & tips

1. **`staticGroupAssignment: true`** — uden dette holder gruppetildelingen ikke; ISE re-profiler endpointet.
2. **Double-nested custom attributes** — `{ customAttributes: { customAttributes: { ... } } }` — mærkelig, men det er ERS.
3. **ERS `customAttributes` PUT merger — den erstatter ikke blokken.** Hvis du udelader en nøgle i PUT-payloaden bevarer ISE den gamle værdi. For at *rydde* et custom attribute skal nøglen sendes eksplicit med tom streng (`"Owner": ""`). Empirisk verificeret i ISE 3.4: blev opdaget da "Sync fra ISE" gendannede en værdi der netop var blevet slettet via attribut-administrationen.
4. **ERS list returnerer kun id+name+link** — for alle andre felter (groupId, description, profileId, customAttributes) skal du GET individuelt.
4. **MAC format** — ISE accepterer `AA:BB:CC:DD:EE:FF` og `AA-BB-CC-DD-EE-FF`. Normér altid til kolon-separeret uppercase.
5. **Port 9060 vs 443** — begge virker. Siden ISE 3.1 anbefales 443 via API gateway.
6. **ERS SDK** — `https://<ise>:9060/ers/sdk` giver auto-genereret doku med schema-filer, Java/Python eksempler, og cURL use cases. Kun tilgængelig for ERS Admin.
7. **Swagger UI** — `https://<ise>/api/swagger-ui/index.html` for Open API interactive docs.
8. **pxGrid 2.0 `/pxgrid/control/AccessSecret`** — bemærk: kortform uden "Create"-suffix, modsat de tre andre control-plane calls (`AccountCreate`, `AccountActivate`, `ServiceLookup`). ISE 3.4 returnerer **404** hvis du kalder `/AccessSecretCreate` (let trap fordi naming-mønstret bryder med de øvrige). Verificeret empirisk på ISE 3.4 — Cisco DevNet samples (cisco-pxgrid/pxgrid-rest-ws) bruger også kortformen.

---

## pxGrid 2.0 — empiriske erfaringer fra portalen

Dokumenteret i forbindelse med implementering af 3.0.0 → 3.6.x-roadmap'en (REST control plane → STOMP-prober → persistent worker → SSE til frontend → multi-topic).

### Kontrolplan-bootstrap (REST på port 8910)

Sekvensen for førstegangs-onboarding af en pxGrid-klient:

1. `POST /pxgrid/control/AccountCreate { "nodeName": "<klient-navn>" }` — registrér klienten. ISE returnerer typisk `accountState=PENDING` første gang.
2. **Manuel approve i ISE GUI** — Administration → pxGrid Services → Clients → ✅ approve. Eller opsæt "Automatically approve new certificate-based accounts" hvis du vil have automation.
3. `POST /pxgrid/control/AccountActivate {}` — første gang efter approve returneres `password`-felt; gem det.
4. Efterfølgende calls bruger Basic auth `(node_name, password)` oven på mTLS.

**Gotchas i bootstrap:**
- **HTTP 503 på AccountCreate** når klienten allerede er registreret. ISE 3.4 burde returnere idempotent 200, men gør det ikke — fall back til AccountActivate for at få faktisk state.
- **HTTP 401/403** efter succesfuld TLS-handshake = cert er valid som transport, men account-validation fejlede. Tjek at MS-CA-rooten er importeret i ISE → pxGrid Services → Certificates → Trusted Certificates.
- **CSR SAN-krav (RFC 6125):** ISE 3.4 accepterer minimum CN, men best practice er at inkludere både `node_name` og host-FQDN som `SubjectAlternativeName:dNSName`. Uden SAN faldt tidlige builds tilbage på CN-matching, men det er deprecated pr. RFC 6125.

### WebSocket-laget — to-lags auth

Pubsub-broker'en (`com.cisco.ise.pubsub`, port 8910) **kræver HTTP Basic auth på selve WebSocket-upgraden** oven på mTLS. STOMP CONNECT-frame'ens login/passcode-felter er IKKE tilstrækkelige — uden `Authorization: Basic <b64(node:secret)>`-header på upgrade-requesten afviser ISE handshaken med 401 inden vi når STOMP-laget.

```python
# Korrekt
async with websockets.connect(
    ws_url, ssl=ssl_ctx, subprotocols=["v12.stomp"],
    additional_headers={"Authorization": f"Basic {b64_basic}"},
    ping_interval=None,  # broker bruger STOMP heart-beat, ikke WS ping
) as ws: ...
```

`ping_interval=None` er vigtigt — broker forventer STOMP heart-beat-frames (bare `\n`), ikke WS ping/pong.

### STOMP heart-beat & reconnect

- CONNECT-frame skal annoncere `heart-beat: 0,30000` (eller justérbar — 0 = vi sender ikke, 30000ms = vi forventer broker sender hvert 30s).
- Sæt `recv_timeout` til ~2× heart-beat-intervallet — så detekteres en død forbindelse hurtigt.
- Ved reconnect: lav **fresh `AccessSecret`** — broker afviser genbrug af tidligere secret. Også fresh `ServiceLookup` så PSN-failover virker hvis primær node er nede.
- Eksponentiel backoff anbefales (1 → 300s cap) for at undgå storm ved ISE-restart.

### Topics — hvad firer ISE faktisk på?

**Empirisk verificeret på ISE 3.4 og 3.5 (egen test-deployment):**

| Topic | Firer på | Noter |
|---|---|---|
| `/topic/com.cisco.ise.session` | RADIUS session lifecycle (STARTED, AUTHENTICATED, DISCONNECTED) | Den eneste topic der pålideligt firer i alle setups. Bruges til auth-status grøn/rød. |
| `/topic/com.cisco.ise.session.group` | Identity-group ændringer for session | Samme service som .session. |
| `/topic/com.cisco.ise.config.anc` | ANC-policy ændringer (Adaptive Network Control) | Konfig-events, ikke endpoint-events. |
| `/topic/com.cisco.ise.endpoint` | "Endpoint attribute changes apart from timestamps and statistics" — i praksis: **profiler-drevne** ændringer, IKKE admin-GUI CRUD | ServiceLookup returnerer topic, SUBSCRIBE accepteres, men ingen events kommer ved manuelt admin-create. Cisco's design — ikke bug. |
| `/topic/com.cisco.ise.config.profiler` | Profiler-policy ændringer | Konfig, ikke endpoint-data. |

**Vigtigste konklusion:** Der findes **INGEN pxGrid 2.0-vej** til real-time admin-CRUD-mirror af endpoint-databasen i ISE 3.4 eller 3.5. Cisco's egen anbefaling er periodisk ERS-poll med passende interval. Portalen bruger 2.8.0-cache med stale-while-revalidate som standardløsning.

### pxGrid policy — publish vs subscribe

Hver topic kræver TO policy-entries i ISE → Administration → pxGrid Services → pxGrid Policy:

```
Service: com.cisco.ise.pubsub
Operation: publish /topic/<navn>
Groups: Internal       ← ISE selv

Service: com.cisco.ise.pubsub
Operation: subscribe /topic/<navn>
Groups: <din klients gruppe>   ← portalen
```

Hvis kun publish-policy findes, kan klienten ikke modtage. Hvis kun subscribe-policy findes, publicerer ISE ikke topic'et internt. Begge skal være på plads.

### ServiceLookup-properties — discovery

For at undgå hardcoded topic-navne: kør altid `ServiceLookup` på service-name og brug returnerede `properties.topic` (eller `wsPubsubTopic`/`endpointTopic`). Eksempel-respons:

```json
{
  "wsPubsubService": "com.cisco.ise.pubsub",
  "restBaseUrl": "https://ise2.ll.lan:8910/pxgrid/ise/endpoint",
  "topic": "/topic/com.cisco.ise.endpoint"
}
```

`restBaseUrl`-tilstedeværelsen indikerer at servicen også har REST-API til pull-baseret query (ikke kun event-stream).

---

## ERS SDK — komplet ressource-oversigt (verificeret ISE 3.4, ERS_V1.json)

Specifikation hentet fra `https://<ise>/ers/pages/ERS_V1.json` (OpenAPI 3.0.1, 376 operationer, 210 paths).
Base URL: `https://<ise>:443/ers/config/` (port 443 via API gateway, anbefalet siden ISE 3.1).

**VIGTIG begrænsning:** ERS er udelukkende konfigurationsAPI. Der er INGEN session-, RADIUS- eller runtime policy-data i ERS. `ISEPolicySetName` og `AuthorizationPolicyMatchedRule` eksisterer ikke i nogen ERS-ressource.

### Ressourcer i brug i portalen

| Ressource | Metoder | Felter/formål |
|---|---|---|
| `endpoint` | GET/POST/PUT/DELETE/PATCH | mac, groupId, profileId, customAttributes, staticGroupAssignment, mdmAttributes |
| `endpointgroup` | GET/POST/PUT/DELETE/PATCH | id, name, description, systemDefined, parentId |
| `authorizationprofile` | GET/POST/PUT/DELETE/PATCH | daclName, vlan, accessType, airespaceACL, acl, advancedAttributes, reauth, webRedirection |
| `downloadableacl` | GET/POST/PUT/DELETE/PATCH | dacl (ACE-indhold), daclType (IPV4/IPV6/IP_AGNOSTIC) |
| `ancendpoint` | GET/PUT apply/PUT clear | macAddress, policyName — apply/clear karantæne |
| `ancpolicy` | GET/POST/PUT/DELETE | name, actions (QUARANTINE/PORTBOUNCE/SHUTDOWN/REMEDIATE) |
| `networkdevice` | GET/POST/PUT/DELETE/PATCH | NetworkDeviceIPList, NetworkDeviceGroupList, modelName, softwareVersion, authenticationSettings, snmpsettings |
| `networkdevicegroup` | GET/POST/PUT/DELETE/PATCH | name (NDG-sti fx `Device Type#All#Cisco#9800`), othername (NDG-type) |

### Ressourcer med portal-potentiale (uudnyttede)

| Ressource | Metoder | Hvad vi kan bruge det til |
|---|---|---|
| `profilerprofile` | GET list/GET id (read-only) | Liste alle ISE profiler-navne → vise profil-chip på endpoint (fx "Apple-iPhone", "Windows10") |
| `sgt` | GET/POST/PUT/DELETE | Security Group Tags: name, value (2–65519), defaultSGACLs → SGT-navn i session-kolonnen |
| `sgacl` | GET/POST/PUT/DELETE | SG-ACL indhold: aclcontent, ipVersion, sgAclType (TRUSTSEC/TRAFFIC_STEERING) |
| `egressmatrixcell` | GET/POST/PUT/DELETE + clearall/clone/setStatus | TrustSec egress matrix management |
| `node` | GET list/GET by name/GET by id (read-only) | Alle ISE-noder: fqdn, ipAddress, nodeServiceTypes, papNode, pxGridNode → deployment-oversigt |
| `sessionservicenode` | GET list/GET by name/GET by id (read-only) | PSN-noder med ipAddress → vis aktive PSN'er i Settings |
| `pxgridnode` | GET/DELETE/approve | pxGrid-klienter: status, groups, authMethod → godkend klienter fra portalen |
| `pxgridsettings` | `PUT /pxgridsettings/autoapprove` | Auto-approve pxGrid cert-baserede klienter — kan aktiveres fra portalen |
| `ancendpoint` (GET) | `GET /ancendpoint/` | Hent alle aktive ANC-bindinger → vis hvilke endpoints der ER i karantæne pt. |
| `deploymentinfo` | `GET /deploymentinfo/getAllInfo` | networkAccessInfo, profilerInfo, nadInfo, licensesInfo, postureInfo — deployment-status |
| `internaluser` | GET/POST/PUT/DELETE/PATCH | ISE lokale brugere — evt. ISE-bruger administration fra portalen |
| `identitygroup` | GET/POST/PUT/DELETE/PATCH | Identity groups (parent-sti) — bruges til purge-bypass og session identity |

### Ressourcer uden portal-relevans

- **Guest management**: `guestuser`, `guesttype`, `guestssid`, `sponsorgroup`, `sponsorportal`, `sponsoredguestportal`, `hotspotportal`, `selfregportal`, `byodportal`, `mydeviceportal`
- **TACACS+**: `tacacsprofile`, `tacacscommandsets`, `tacacsexternalservers`, `tacacsserversequence`
- **Identity stores**: `ldap`, `activedirectory`, `idstoresequence`, `restidstore`, `certificateprofile`
- **SXP/TrustSec infrastruktur**: `sxpconnections`, `sxplocalbindings`, `sxpvpns`, `sgmapping`, `sgmappinggroup`, `sgtvnvlan`
- **ACI integration**: `acibindings`, `acisettings`
- **ISE operations**: `supportbundle`, `supportbundledownload`, `systemcertificate`, `telemetryinfo`
- **Portals/themes**: `portalglobalsetting`, `portaltheme`

### Bekræftede gotchas fra ERS_V1.json

- **`ancendpoint/getEndpointByMac` eksisterer IKKE i spec** — hverken i ISE 3.4 ERS_V1.json (376 operationer) eller i SDK. Er enten fjernet eller aldrig officielt tilgængeligt. Brug `ancendpoint/{id}` eller filtrér GET list.
- **`profilerprofile` er read-only** — POST/PUT/DELETE er ikke tilgængeligt. Profiler-definitioner administreres udelukkende af ISE's profiler-engine.
- **`node` og `sessionservicenode` er read-only** — ingen POST/PUT/DELETE. Kun til discovery/visning.
- **`pxgridnode` approve**: `PUT /pxgridnode/name/{name}/approve` — kan bruges til at approve portalen som pxGrid-klient programmatisk i stedet for via GUI.
- **`pxgridsettings` autoapprove**: `PUT /pxgridsettings/autoapprove` — slår auto-approve til for cert-baserede pxGrid-klienter.
- **ERS OpenAPI version er 3.1.0** selvom ISE kører 3.4 — spec-versionen er statisk og opdateres ikke med minor ISE releases.

---

## Auth/Authz policy-navne i sessioner — hvad virker

Dette er det vigtigste spørgsmål for Browse session-kolonnen: kan vi vise "Auth: MAC ByPass / Authz: SSID 802 PSK Mode"?

### Bekræftede negative resultater

| Kilde | Resultat | Bekræftet |
|---|---|---|
| **ERS** (alle 376 operationer) | ❌ Ingen session-data overhovedet | Verificeret via ERS_V1.json |
| **pxGrid getSessions** | ❌ Returnerer `selectedAuthzProfiles` men IKKE `policySetName` eller `authorizationRuleName` | Bekræftet via debug-log — alle felter var `None` |
| **pxGrid getSessionByMacAddress** | ❌ Samme service, samme felter som getSessions | Forventet — ikke testet separat |
| **MnT `/admin/API/mnt/Session/ActiveList`** | ❌ Returnerer kun 7 felter: `acct_session_id`, `audit_session_id`, `calling_station_id`, `framed_ipv6_address`, `nas_ip_address`, `server`, `user_name` | Bekræftet via debug-log |

### Uafprøvede kandidater

| Kilde | Status | Forventet indhold |
|---|---|---|
| **MnT `/admin/API/mnt/Session/MACAddress/{mac}`** | ✅ Felter dokumenteret via Ansible ISE SDK | Indeholder IKKE `ISEPolicySetName`/`AuthorizationPolicyMatchedRule`. Returnerer dog `endpoint_policy`, `dacl`, `vlan`, `cts_security_group` som er nye nyttige felter. |
| **MnT `/admin/API/mnt/AuthStatus/MACAddress/{mac}/{s}/{n}/All`** | ⏳ Probe deployeret (b0341) — ikke testet endnu | Auth-events per MAC, RADIUS live log-lignende. Indhold ukendt. |
| **ISE Context Visibility API** | ❌ Kræver `ContextVisibility` eller `Super Admin`-rolle — højere end ERS Admin | `ISEPolicySetName`, `AuthorizationPolicyMatchedRule` tilgængeligt men kræver rolle-opgradering |

### Probe-endpoint (admin-only)

```
GET /api/pxgrid/probe/mnt/{mac}
```

Kalder begge MnT detail-endpoints og returnerer alle XML-felter ISE leverer. Logges til `app.log`. Brug en MAC fra en aktiv session. Resultat afgør om enrichment-implementering er mulig.

### Fallback — hvad portalen viser i dag

```
Authz: Endpoint_AirSpaceACL, Endpoint_PSK-KEY, Endpoint_VLAN, PermitAccess
```

`selectedAuthzProfiles` fra pxGrid getSessions er den eneste policy-information tilgængeligt uden Context Visibility-rolle.

---

## MnT — Session API (komplet, verificeret fra Cisco DevNet + Ansible ISE SDK)

MnT REST API har 3 kategorier og 14 endpoints. Alle kræver `MnT Admin`, `System Admin` eller `Super Admin`-rolle.
**Kun interne ISE-brugere** — externe ID stores (AD, LDAP) understøttes ikke til MnT-auth.

### Komplet endpoint-liste

#### Session Management

| Path | Metode | Beskrivelse |
|---|---|---|
| `/admin/API/mnt/Session/ActiveCount` | GET | Antal aktive sessioner (én integer) |
| `/admin/API/mnt/Session/PostureCount` | GET | Antal endpoints med posture-status |
| `/admin/API/mnt/Session/ProfilerCount` | GET | Antal aktive profiler-service sessioner |
| `/admin/API/mnt/Session/ActiveList` | GET | Alle aktive sessioner — **kun 7 felter** (bekræftet empirisk). Max 250.000 sessioner. |
| `/admin/API/mnt/Session/AuthList/{starttime}/{endtime}` | GET | Autentificerede sessioner i tidsinterval. Format: `YYYY-MM-DD hh:mm:ss.s`. Begge parametre kan være `null`. |
| `/admin/API/mnt/Session/MACAddress/{mac}` | GET | Fuld session-detail for MAC (se feltliste nedenfor) |
| `/admin/API/mnt/Session/UserName/{username}` | GET/POST | Session for brugernavn. POST anbefales ved domæne-brugere (GET understøtter ikke backslash) |
| `/admin/API/mnt/Session/IPAddress/{nasip}` | GET | Session(er) for NAS IP-adresse (IPv4 og IPv6) |
| `/admin/API/mnt/Session/Active/SessionID/{audit-session-id}/0` | GET | Session for audit session ID |

#### Troubleshooting

| Path | Metode | Beskrivelse |
|---|---|---|
| `/admin/API/mnt/Version` | GET | Node-version og type (0=standalone, 1=aktiv, 2=standby, 3=non-MnT) |
| `/admin/API/mnt/FailureReasons` | GET | Fejlkoder, årsager og løsninger. Kald én gang og cache lokalt. |
| `/admin/API/mnt/AuthStatus/MACAddress/{mac}/{seconds}/{records}/All` | GET | Auth-events for MAC i tidsvindue. `seconds` 0–432000 (5 dage). Felter **ukendte** — probe ikke udført endnu. |
| `/admin/API/mnt/AcctStatusTT/MACAddress/{mac}/{seconds}` | GET/PUT | Accounting-status i tidsperiode. Felter: macAddress, acctStatusElements (calling_station_id, paks_in/out, bytes_in/out, session_time, server) |

#### Change of Authorization (CoA)

| Path | Metode | Beskrivelse |
|---|---|---|
| `/admin/API/mnt/CoA/Reauth/{psn}/{mac}/{type}/{nasip}/{dstip}` | GET | CoA reauth. `nasip` og `dstip` er valgfrie. type: 0=default, 1=last, 2=rerun |
| `/admin/API/mnt/CoA/Disconnect/{psn}/{mac}/{type}/{nasip}/{dstip}` | GET | CoA disconnect. type: 0=default, 1=bounce, 2=shutdown |

**OBS:** Portalen bruger `nasip`/`dstip`-parametrene ikke i dag — CoA-kaldene virker uden dem hvis PSN-hostnamen matcher.

### Session/MACAddress — felter (verificeret via Ansible ISE SDK)

```
Autentificering:   user_name, authentication_method, authentication_protocol,
                   auth_id, identity_store, identity_group

Netværk/NAS:       calling_station_id, orig_calling_station_id, nas_ip_address,
                   nas_ipv6_address, nas_port_id, network_device_name,
                   device_ip_address, device_type, interface_name

IP/Adressering:    framed_ip_address, framed_ipv6_address, vlan,
                   destination_ip_address

Session-IDs:       audit_session_id, acct_session_id, cpmsession_id,
                   acct_multi_session_id

Accounting:        acct_session_time, acct_input_octets, acct_output_octets,
                   acct_input_packets, acct_output_packets, acct_class,
                   acct_terminate_cause, acct_status_type

Sikkerhed/Policy:  selected_azn_profiles ← tilgængeligt (vi har det allerede fra pxGrid)
                   endpoint_policy       ← NY: ISE profiler-tildelt policy-navn
                   dacl                  ← NY: pushede DACL-navn
                   vlan                  ← NY: tildelt VLAN
                   cts_security_group    ← NY: TrustSec SGT-navn
                   security_group, posture_status

Status/Debug:      execution_steps, message_code, failure_reason, response_time

Tidsstempler:      event_timestamp, started, stopped,
                   auth_acs_timestamp, acct_acs_timestamp

❌ IKKE tilgængeligt: ISEPolicySetName, AuthorizationPolicyMatchedRule
```

`endpoint_policy`, `dacl`, `vlan` og `cts_security_group` er de interessante nye felter der **ikke** er tilgængelige via pxGrid getSessions eller MnT ActiveList.

### Session/ActiveList — felter (bekræftet empirisk ISE 3.4)

Returnerer KUN disse 7 felter:
`acct_session_id`, `audit_session_id`, `calling_station_id`, `framed_ipv6_address`, `nas_ip_address`, `server`, `user_name`

### Auth/Authz policy-navne — endelig konklusion

| Kilde | ISEPolicySetName | AuthorizationPolicyMatchedRule | Status |
|---|---|---|---|
| ERS (alle 376 ops) | ❌ | ❌ | Verificeret — ingen session-data |
| pxGrid getSessions | ❌ | ❌ | Empirisk bekræftet |
| MnT ActiveList | ❌ | ❌ | Empirisk bekræftet |
| MnT Session/MACAddress | ❌ | ❌ | Bekræftet via Ansible SDK |
| MnT AuthStatus/MACAddress | ❓ | ❓ | **Ukendt — probe ikke udført** |
| ISE Context Visibility | ✅ | ✅ | Kræver ContextVisibility/Super Admin rolle |

**Konklusion:** `ISEPolicySetName` og `AuthorizationPolicyMatchedRule` er IKKE tilgængeligt uden enten (a) at opgradere ISE-brugerens rolle til `ContextVisibility` eller (b) at `AuthStatus/MACAddress` viser sig at indeholde dem (probe afventer).

### Fælles for alle MnT endpoints

- **Auth**: Basic auth — kræver MnT Admin eller Super Admin (ikke ERS Admin)
- **Response format**: XML (`Accept: application/xml`) — ikke JSON
- **401 med HTML-body**: manglende MnT Admin-rolle, ikke forkert password
- **MAC-format i URL**: kolon-separeret uppercase (`AA:BB:CC:DD:EE:FF`) URL-encoded som `%3A` i path-segmenter
- **Tidsparam format**: `YYYY-MM-DD hh:mm:ss.s` — kan sættes til `null` for ingen begrænsning

---

## Endpoint Purge — hvad virker og hvad gør ikke

**Sti i ISE GUI:** Administration → Identity Management → Settings → Endpoint Purge → Never Purge.

### API-tilgængelighed

**Der findes INGEN ERS- eller Open API til at oprette/læse/ændre purge-rules** — hverken i ISE 3.4 eller 3.5. Det er ren GUI-konfiguration. Verificeret via Cisco DevNet API Framework + Cisco Community-tråde.

### Custom attribute som condition

| ISE-version | CUSTOMATTRIBUTE som purge-condition | Note |
|---|---|---|
| 3.4 og tidligere | ❌ Ikke understøttet | Cisco docs: *"You cannot use a custom attribute as a condition for an endpoint purge policy."* Brug Identity Group som condition i stedet. |
| 3.5 | ✅ Understøttet | Ny condition-type "CUSTOMATTRIBUTE". Skift til 3.5 hvis I har behov. |

### Anbefalet portal-purge-bypass

Portalen stempler altid `HypervisionISEPortal=true` på create + update. Admin opretter manuelt én "Never Purge"-rule:

- **Rule Name:** `HyperVision Portal`
- **Condition:** `CUSTOMATTRIBUTE HypervisionISEPortal EQUALS true` (ISE 3.5+)
- **Status:** Enabled

På ISE 3.4 kan man i stedet bruge en dedikeret Endpoint Identity Group:
- **Condition:** `Endpoint Identity Group EQUALS HypervisionPortalManaged`

### `DeviceRegistrationStatus`-attributten

Indbygget BYOD-attribut. Den fungerer som purge-bypass-condition i ISE's default `EnrolledRule` (`if DeviceRegistrationStatus Equals Registered then never purge`). MEN:

- Den indbyggede DRS sættes kun via BYOD/MyDevices-portal-flow.
- Vi forsøgte at definere en custom attribute kaldet `DeviceRegistrationStatus` og stemple `Registered` (3.7.0). På ISE 3.4 virker dette IKKE som purge-bypass fordi custom attributes ikke kan bruges som condition på den version. På 3.5 ville det virke, men det er overflødigt nu hvor `HypervisionISEPortal=true` matcher samme endpoints. Tilbagerullet i 3.7.1.
