<!-- Version: 4.0.5 | Opdateret: 2026-05-10 -->

# 03 — Brugervejledning

---

## Sidebar og brugerinfo

Sidebarens nederste del viser tre linjer om den aktuelle session:

| Linje | Indhold |
|---|---|
| **User** | Brugernavn du er logget ind med |
| **Rolle** | Din portal-rolle (admin, editor, viewer osv.) |
| **Login auth** | `TACACS+` (blå) hvis logget ind via TACACS+-server, `LOCAL` (grøn) hvis lokal passwordauth |

Herunder er der links til **Log ud** og **Præferencer**.

### Præferencer

Præferencer-siden er tilgængelig for alle brugere uanset auth-metode.

- **Brugere med lokal auth** kan skifte password samt justere frontend-præferencer (tema, sidestørrelse).
- **TACACS+-brugere** kan justere frontend-præferencer, men kan ikke skifte password — passwords administreres af TACACS+-serveren. Passwordformularen erstattes af en informationsbesked.

---

## Browse og Edit

Browse er portalens primære arbejdsside. Den viser alle endpoints du har adgang til som en tabel med filtrering, søgning, kolonnevalg og realtids sessions-farvning.

### Tabel-kolonner

Standardkolonner der vises ved opstart:

| Kolonne | Indhold |
|---|---|
| Checkbox | Vælg række til bulk-operationer. Grøn = aktiv RADIUS-session; rød = ingen session |
| MAC-adresse | Endpointets MAC |
| Identity Group | ISE endpoint-gruppe |
| Beskrivelse | Fritekstbeskrivelse |
| HypervisionRoles | System adm-tag(s) — afgrænser hvem der kan se endpoint |
| AuthzVlan | Autorisations-VLAN (custom attribute) |
| AuthzACL | Autorisations-ACL (custom attribute) |
| PSK Key | PSK-nøgle — kun synlig for editor-psk og admin |
| Owner / Location | Custom attributes til ejerskab og placering |
| System adm | Kombineret system adm-info |

Kolonner kan til- og fravælges via **Kolonner**-knappen i værktøjslinjen. Valget gemmes i browser localStorage.

### Søg og filtrer

- **Søgefelt**: fritekst-søgning på MAC, beskrivelse og custom attributes. Søgningen sker mod den indlæste data-side — ikke en fuld ISE-søgning på tværs af alle sider.
- **Filter**: dropdown med Identity Group, system adm-tags og andre attribut-værdier. Flere filtre kombineres med AND.

### Sessionsfarve (grøn/rød)

Checkboxens baggrund afspejler om endpoint har en aktiv RADIUS-session i ISE:

- **Grøn**: aktiv session — klienten er autentificeret og tilknyttet
- **Rød/hvid**: ingen aktiv session

Farvning opdateres via pxGrid i realtid (hvis aktiveret) eller ved MnT-poll-interval.

### Edit-modal

Dobbeltklik på en rækkes MAC-adresse (eller brug ▶-pilen) for at åbne edit-modalen. Modalen henter altid de seneste data direkte fra ISE.

Felter du kan redigere:

- Beskrivelse
- Identity Group
- Custom attributes (AuthzVlan, AuthzACL, Owner, Location, PSK_Key, PSK_Mode, HypervisionRoles, m.fl.)

Klik **Gem** for at sende ændringen til ISE via `PUT /api/endpoints/{id}`.

**Prøv igen-knap**: hvis ISE er midlertidigt utilgængeligt vises en venlig fejlbesked med en **Prøv igen**-knap. Portalen viser evt. cachelagrede data med et ⏱-badge som indikerer at data muligvis er forældet.

### Bulk-edit

Marker flere rækker (Shift+klik for interval) og klik **Bulk-edit** i toolbar. Du kan redigere ét eller flere felter på alle markerede endpoints på én gang.

### CoA (Change of Authorization)

Fra toolbar-knapperne eller edit-modal:

- **CoA Reauth**: tvinger ISE til at evaluere klientens policy på ny uden at kaste sessionen. Brug når du har ændret VLAN eller ACL og ønsker øjeblikkelig effekt.
- **CoA Disconnect**: deautentificerer klienten (session fjernes fra WLC/switch). Klienten kører DHCP DORA på ny og får en ny IP. Brug ved VLAN-skift der kræver ny IP.

CoA sendes via MnT API og kræver MnT Admin-rettigheder på ISE-kontoen.

---

## Opret endpoint

Navigér til **Opret** i menuen.

Påkrævede felter:

- **MAC-adresse**: format `AA:BB:CC:DD:EE:FF` eller `AA-BB-CC-DD-EE-FF`. Bindestreg og kolon accepteres og normaliseres.
- **Identity Group**: vælg fra dropdown (hentes live fra ISE).

Valgfrie felter:

- Beskrivelse
- Custom attributes (AuthzVlan, AuthzACL, PSK-felter m.fl.)
- HypervisionRoles (System adm-tag) — udfyldes automatisk med dit brugernavn hvis du ikke vælger andet og ikke er admin

Klik **Opret** — portalen sender `POST /api/endpoints` og viser bekræftelse med ISE-ID.

---

## Import fra CSV

Navigér til **Import** i menuen.

Portalen understøtter to CSV-formater:

### ISE-format (fuld export fra ISE)

Headerrække med kolonnenavne som `MACAddress`, `IdentityGroup`, `CustomAttributes.VLAN_ID` osv. Portalen auto-detekterer formatet og mapper kolonner til ISE-felter.

### Simpelt format

Minimal CSV med kun de felter du har:

```
MAC,Identity Group,Beskrivelse,AuthzVlan
AA:BB:CC:11:22:33,Employees,Printer 3. sal,VLAN20
```

### Import-flow

1. Upload CSV-fil — portalen viser en preview med mapning og de første rækker.
2. Tjek at kolonner er korrekt mappet. Justér evt. manuelt.
3. Klik **Importér** — portalen opretter endpoints én ad gangen og viser en succeeded/failed-rapport.

Fejlede rækker (f.eks. duplikeret MAC i ISE, ugyldigt format) vises med årsag i rapporten. Vellykkede rækker importeres uanset fejlede.

---

## Attributter

Navigér til **Attributter** i menuen (kræver editor- eller admin-adgang).

Attribut-siden lader dig administrere de custom attributes portalen bruger.

### Custom attribute-definitioner

Listen viser alle custom attributes defineret i ISE via Open API. Du kan:

- Tilføje nye custom attribute-definitioner direkte til ISE
- Redigere eksisterende definitioner (navn og type)

**Bemærk**: Sletning af en custom attribute-definition i ISE fjerner attributten fra alle endpoints — dette er irreversibelt.

### PlatformType-mapping

Portalen kan mappe en enhedstype (f.eks. `PLC`, `Printer`, `IP-kamera`) til forudbestemte ISE-attribut-værdier. Når du opretter et endpoint og vælger PlatformType udfyldes AuthzVlan, AuthzACL og Identity Group automatisk med de mappede standardværdier.

Rediger mapping-tabellen og klik Gem. Mapping gemmes i portal-konfigurationen (ikke i ISE).

### CoA-binding

Du kan konfigurere at specifikke attribut-ændringer (f.eks. ændring af AuthzVlan) automatisk udløser CoA Reauth ved Gem i edit-modal. Slå bindings til/fra per attribut.

---

## ACL-editor

Navigér til **ACL** i menuen (kræver editor- eller admin-adgang).

ACL-editoren administrerer Downloadable ACL'er (DACL'er) i ISE.

### Liste

Viser alle DACL'er defineret i ISE med navn, type (IP/IPv6) og linjetal.

### Redigér DACL

Klik på en DACL for at åbne editoren. Editoren har:

- Fritekst-felt til Cisco IOS ACL syntax
- **Live syntaksvalidering**: portalen checker ACL-linjer mens du skriver og markerer ugyldige linjer
- **Gem til ISE**: sender den redigerede DACL tilbage til ISE via Open API

### Gyldig Cisco IOS ACL-syntax

```
permit ip any any
deny ip 10.0.0.0 0.255.255.255 any
permit tcp any any eq 443
permit udp any any eq 53
deny ip any any
```

ACL-validatoren kender de mest brugte Cisco IOS ACE-varianter. Ukendte konstruktioner markeres med advarsel men blokerer ikke for Gem.

---

## PSK-workflow

PSK (Pre-Shared Key) bruges i ISE MPSK og IPSK konfigurationer til trådløs adgang.

### PSK-felter

- **PSK_Key**: selve PSK-nøglen (adgangskode for SSID). Maskeres i Browse-tabellen for brugere der ikke har editor-psk-rollen.
- **PSK_Mode**: mode-attribut der angiver om endpoint bruger MPSK, IPSK eller ingen PSK.

### editor-psk rollen

Kun brugere med rollen **editor-psk** (og admin) kan se umaskerede PSK-nøgler og redigere PSK_Key-feltet. Brugere med editor-rollen ser `••••••` i PSK-kolonnen og kan ikke redigere PSK_Key.

### Opret endpoint med PSK

1. Navigér til Opret.
2. Udfyld MAC, Identity Group og øvrige felter.
3. Udfyld **PSK_Key** og sæt **PSK_Mode** til `MPSK` eller `IPSK`.
4. Klik Opret.

---

## Register-view (registrant / registrant_templet)

Rollerne `registrant` og `registrant_templet` har adgang til et mobiloptimeret register-view tilpasset fieldteknikere der registrerer nyt udstyr on-the-spot.

**registrant** ser det fulde opret-formular med alle felter.

**registrant_templet** ser et forenklet formular — kun valg af skabelon, MAC-adresse og beskrivelse. Admin tildeler hvilke skabeloner den pågældende bruger har adgang til.

Viewet viser:

- Kun de endpoints der er tagget med brugerens username (egne endpoints)
- En "Mine endpoints"-liste som henter data på tværs af alle ISE-sider

Registrant kan ikke redigere endpoints eller se andre brugeres data.

---

## Fejlbeskeder

Portalen erstatter tekniske HTTP-fejl med brugervenlige beskeder.

| Situation | Besked i portal |
|---|---|
| ISE timeout eller netværksfejl | "ISE er midlertidigt utilgængelig — prøv igen om lidt" + Prøv igen-knap |
| Endpoint ikke fundet i ISE | "Endpoint ikke fundet i ISE" |
| ISE returnerede uventet fejl | "ISE returnerede en uventet fejl (HTTP NNN)" |
| Ugyldig MAC-format | Inline validering ved udfyldning — Opret-knap deaktiveres |
| Manglende påkrævet felt | Inline validering |
| Ikke tilstrækkeligt adgang | 403-fejl med dansk besked |

**Stale-badge (⏱)**: vises i Browse på rækker hvis endpoint-data hviler på disk-cache (ikke valideret mod ISE endnu). Badget forsvinder når pre-warm workeren har genbekræftet dataene.
