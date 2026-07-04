<!-- Version: 6.26.0730 | Opdateret: 2026-07-04 -->

# HyperVision ISE Portal — Dokumentationsindeks

Dette er hoveddokumentet for HyperVision ISE Portal version **6.26 build 0730**. Alle sektioner i manualen er selvstændige filer; dette dokument fungerer som navigationspunkt og overblik over dokumentationsstrukturen.

> **Aktuelt funktions-niveau:** [README.md](../README.md) og [FEATURES.md](../FEATURES.md) er den autoritative, altid-opdaterede oversigt over portalens funktioner; [CHANGELOG.md](../CHANGELOG.md) og [RELEASE_NOTES.md](../RELEASE_NOTES.md) dækker hver enkelt version. De uddybende manual-afsnit nedenfor (01–05) opdateres periodisk og kan beskrive et lidt ældre funktions-niveau end README/CHANGELOG.

---

## Dokumentationsstruktur

Manualen er opdelt i fem indholdsfiler plus dette indeks. Hver fil dækker et afgrænset emne og kan læses uafhængigt. Rækkefølgen afspejler en naturlig onboarding: forstå systemet, installer det, brug det, administrer det, og hold det kørende.

```
docs/
  INDEX.md            — dette dokument (navigation og ændringslog)
  01-OVERBLIK.md      — systemkomponenter, arkitektur, integrationer, roller
  02-INSTALLATION.md  — forudsætninger, installation, ISE-konfiguration
  03-BRUGERGUIDE.md   — vejledning for alle portal-sider
  04-ADMIN.md         — administration, settings, TACACS+, pxGrid, opdatering
  05-DRIFT.md         — drift, backup, fejlsøgning, ydelsestuning
```

---

## Indholdsfortegnelse

### [01 — Systemoverblik](01-OVERBLIK.md)

- [Formål og målgruppe](01-OVERBLIK.md#formål-og-målgruppe)
- [Systemkomponenter](01-OVERBLIK.md#systemkomponenter)
- [REST-integration: ERS, Open API og MnT](01-OVERBLIK.md#rest-integration)
- [pxGrid 2.0](01-OVERBLIK.md#pxgrid-20)
- [Cache-arkitektur](01-OVERBLIK.md#cache-arkitektur)
- [Bruger-roller og adgangskontrol](01-OVERBLIK.md#bruger-roller-og-adgangskontrol)
- [TACACS+-autentisering](01-OVERBLIK.md#tacacs-autentisering)
- [Dataflow-eksempler](01-OVERBLIK.md#dataflow-eksempler)

### [02 — Installation](02-INSTALLATION.md)

- [Forudsætninger](02-INSTALLATION.md#forudsætninger)
- [Trin-for-trin installation](02-INSTALLATION.md#trin-for-trin-installation)
- [ISE-konfiguration](02-INSTALLATION.md#ise-konfiguration)
- [Konfigurationsfiler](02-INSTALLATION.md#konfigurationsfiler)
- [START.bat og auto-genstart](02-INSTALLATION.md#startbat-og-auto-genstart)
- [Verificering](02-INSTALLATION.md#verificering)

### [03 — Brugervejledning](03-BRUGERGUIDE.md)

- [Browse og Edit](03-BRUGERGUIDE.md#browse-og-edit)
- [Opret endpoint](03-BRUGERGUIDE.md#opret-endpoint)
- [Import fra CSV](03-BRUGERGUIDE.md#import-fra-csv)
- [Attributter](03-BRUGERGUIDE.md#attributter)
- [ACL-editor](03-BRUGERGUIDE.md#acl-editor)
- [PSK-workflow](03-BRUGERGUIDE.md#psk-workflow)
- [Fejlbeskeder](03-BRUGERGUIDE.md#fejlbeskeder)

### [04 — Administration](04-ADMIN.md)

- [Brugerstyring](04-ADMIN.md#brugerstyring)
- [Settings-sektioner](04-ADMIN.md#settings-sektioner)
- [Portal Auth Config (TACACS+)](04-ADMIN.md#portal-auth-config-tacacs)
- [Cache-indstillinger](04-ADMIN.md#cache-indstillinger)
- [pxGrid-opsætning](04-ADMIN.md#pxgrid-opsætning)
- [System-opdatering](04-ADMIN.md#system-opdatering)
- [Logs-siden](04-ADMIN.md#logs-siden)

### [05 — Drift](05-DRIFT.md)

- [Start, stop og genstart](05-DRIFT.md#start-stop-og-genstart)
- [Backup](05-DRIFT.md#backup)
- [Log-rotation og -vedligeholdelse](05-DRIFT.md#log-rotation-og--vedligeholdelse)
- [Fejlsøgningsguide](05-DRIFT.md#fejlsøgningsguide)
- [Ydelsestuning](05-DRIFT.md#ydelsestuning)
- [ISE-timeout anbefalinger](05-DRIFT.md#ise-timeout-anbefalinger)

---

## Ændringslog for manualen

Nyeste øverst. Kun ændringer i selve dokumentationen registreres her — for kodeændringer, se [CHANGELOG.md](../CHANGELOG.md).

| Version | Dato | Ændring |
|---|---|---|
| 4.0.5 build 0232 | 2026-05-10 | Bruger/Operatør-type, kopiér bruger, Login auth-badge i sidebar, Præferencer for TACACS-brugere, eget System adm-tag fremhævet i lyserød |
| 4.0.1 build 0220 | 2026-05-09 | Opdateret til v4: TACACS+-autentisering, registrant-roller, Portal Auth Config, ny afhængighed tacacs-plus |
| 3.15.5 build 0168 | 2026-05-07 | Komplet dokumentations-suite oprettet: INDEX + 01–05. Erstatter den tidligere INSTALL.md |
