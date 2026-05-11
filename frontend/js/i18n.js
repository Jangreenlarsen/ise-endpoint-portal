/**
 * i18n — minimalt oversættelsessystem til HyperVision ISE Portal.
 *
 * Prioritet: bruger-præference (server) → portal global default → browser-sprog → "en"
 *
 * Brug: import { t, setLocale, resolveLocale } from "./i18n.js";
 */

const TRANSLATIONS = {
  da: {
    // Navigation
    "nav.browse":       "Gennemse",
    "nav.register":     "Registrér",
    "nav.import":       "Importer",
    "nav.attributes":   "Attributter",
    "nav.dacls":        "DACL'er",
    "nav.logs":         "Logs",
    "nav.audit":        "Audit",
    "nav.metrics":      "Metrics",
    "nav.settings":     "Indstillinger",
    "nav.user-prefs":   "Præferencer",
    "nav.csv-template": "CSV Skabelon",

    // Fælles knapper / labels
    "btn.save":    "Gem",
    "btn.cancel":  "Annuller",
    "btn.delete":  "Slet",
    "btn.edit":    "Rediger",
    "btn.search":  "Søg",
    "btn.refresh": "Opdater",
    "btn.export":  "Eksportér CSV",
    "btn.close":   "Luk",
    "btn.confirm": "Bekræft",
    "btn.create":  "Opret",
    "btn.yes":     "Ja",
    "btn.no":      "Nej",

    // Login
    "login.title":        "Log ind",
    "login.setup_title":  "Første-gangs opsætning",
    "login.username":     "Brugernavn",
    "login.password":     "Password",
    "login.password2":    "Bekræft password",
    "login.submit":       "Log ind",
    "login.setup_submit": "Opret admin & log ind",
    "login.setup_hint":   "Der er ingen brugere endnu. Opret en administrator for at komme i gang.",
    "login.err_backend":  "Kan ikke kontakte backend",
    "login.err_pw_match": "Passwords matcher ikke",

    // Browse — toolbar
    "browse.title":              "Gennemse / Rediger endpoints",
    "browse.btn_refresh":        "Opdater",
    "browse.btn_export":         "Eksportér CSV",
    "browse.btn_columns":        "Kolonner ▾",
    "browse.btn_views":          "📁 Views ▾",
    "browse.btn_portal_filter":  "Kun portal",
    "browse.btn_coa_off":        "CoA reauth: FRA",
    "browse.btn_coa_on":         "CoA reauth: TIL",
    "browse.btn_save_all":       "Gem alle",
    "browse.btn_bulk_edit":      "Rediger valgte",
    "browse.btn_bulk_save":      "Gem valgte",
    "browse.btn_bulk_disconnect":"Disconnect",
    "browse.btn_bulk_delete":    "Slet",
    "browse.label_show":         "Vis",
    "browse.select_all_title":   "Vælg alle",
    "browse.pxgrid_badge":       "⚪ Auth-status: ukendt",
    "browse.pxgrid_badge_title": "Hvor auth-status kommer fra: pxGrid push (live) eller MnT pull (5-15s forsinkelse)",

    // Browse — tabel-tilstande
    "browse.no_results":        "Ingen resultater",
    "browse.loading_rows":      "Indlæser...",
    "browse.page_prev":         "Forrige",
    "browse.page_next":         "Næste",
    "browse.mac_link_title":    "Vis detaljer",
    "browse.stale_badge_title": "Data fra gammel cache — opdateres i baggrunden",
    "browse.extern_role_title": "Bruger-tag eller rolle uden for katalog",

    // Browse — kolonnenavne
    "col.mac":          "MAC",
    "col.vendor":       "Vendor",
    "col.group_name":   "Identity Group",
    "col.static_group": "Tilknytning",
    "col.description":  "Description",
    "col.endpoint_type":"Type",
    "col.owner":        "Owner",
    "col.lokation":     "Lokation",
    "col.platform_type":"Platform",
    "col.psk_mode":     "PSK Mode",
    "col.psk_key":      "PSK Key",
    "col.authz_vlan":   "AuthzVlan",
    "col.authz_acl":    "AuthzACL",
    "col.roles":        "System adm",
    "col.create_time":  "Alder",

    // Browse — celleværdier
    "cell.static":   "Statisk",
    "cell.dynamic":  "Dynamisk",
    "cell.yes":      "Ja",
    "cell.no_group": "— ingen —",

    // Browse — alder-formattering
    "age.today":     "I dag",
    "age.yesterday": "I går",
    "age.days":      "dage",
    "age.months":    "mdr.",
    "age.years":     "år",

    // Browse — detail-modal
    "detail.title":          "Endpoint detaljer",
    "detail.assignment":     "Tilknytning",
    "detail.static_assign":  "Statisk gruppetildeling",
    "detail.psk_mode_lbl":   "MPSK/IPSK aktiveret",
    "detail.profile_name":   "Profil-navn",
    "detail.registered":     "Registreret",
    "detail.last_updated":   "Sidst opdateret",
    "detail.anc_free":       "Fri",
    "detail.anc_quarantine": "Sæt i karantæne",
    "detail.anc_clear":      "Fjern karantæne",
    "detail.anc_loading":    "Henter status…",
    "detail.anc_select":     "— Vælg ANC policy —",
    "detail.btn_save":       "Gem ændringer",
    "detail.btn_disconnect": "Disconnect",
    "detail.btn_close":      "Luk",
    "detail.btn_show":       "Vis",
    "detail.btn_hide":       "Skjul",
    "detail.btn_generate":   "Generer",

    // Browse — bulk-edit-modal
    "bulk.title":             "Rediger valgte endpoints",
    "bulk.count_suffix":      "endpoints valgt",
    "bulk.btn_apply":         "Anvend",
    "bulk.btn_cancel":        "Annuller",
    "bulk.btn_show":          "Vis",
    "bulk.btn_hide":          "Skjul",
    "bulk.btn_generate":      "Generer",
    "bulk.updated_local":     "endpoints opdateret lokalt — tryk \"Gem alle\" eller \"Gem valgte\" for at gemme til ISE.",
    "bulk.deleting":          "Sletter",
    "bulk.deleted":           "slettet",
    "bulk.failed":            "fejlede",
    "bulk.confirm_delete":    "Slet {n} endpoints?\n\n{macs}",
    "bulk.confirm_disconnect":"CoA Disconnect {n} klient(er)?\n\n{macs}\n\nDe bliver deautentificeret på WLC/switch og skal gen-associere.",

    // User-prefs
    "prefs.title":           "Præferencer",
    "prefs.pw_card":         "Skift dit password",
    "prefs.pw_logged_in_as": "Logget ind som",
    "prefs.pw_role":         "rolle",
    "prefs.pw_current":      "Nuværende password",
    "prefs.pw_new":          "Nyt password (min. 8 tegn)",
    "prefs.pw_new2":         "Bekræft nyt password",
    "prefs.pw_submit":       "Skift password",
    "prefs.pw_success":      "Password skiftet.",
    "prefs.pw_err_match":    "De to nye passwords matcher ikke.",
    "prefs.pw_tacacs_hint":  "Password administreres af TACACS+-serveren — det kan ikke skiftes her i portalen.",
    "prefs.pw_tacacs_via":   "via",
    "prefs.frontend_card":   "Frontend-præferencer",
    "prefs.frontend_hint":   "Gemmes i din browser og synkroniseres med serveren.",
    "prefs.page_size":       "Standard sidestørrelse (browse-visning)",
    "prefs.theme":           "Tema",
    "prefs.language":        "Sprog",
    "prefs.lang_auto":       "Automatisk (portal standard)",
    "prefs.lang_da":         "Dansk",
    "prefs.lang_en":         "English",
    "prefs.theme_light":     "Light",
    "prefs.theme_dark":      "Dark",
    "prefs.theme_midnight":  "Midnight",
    "prefs.theme_slate":     "Slate",
    "prefs.submit":          "Gem præferencer",
    "prefs.success":         "Præferencer gemt.",

    // Settings — locale panel
    "settings.locale_card":    "Portalsprog",
    "settings.locale_hint":    "Standardsprog for brugere uden personligt sprogvalg.",
    "settings.locale_label":   "Standard sprog",
    "settings.locale_submit":  "Gem sprogindstilling",
    "settings.locale_success": "Sprogindstilling gemt.",

    // Generelle alert-tekster
    "alert.loading":   "Indlæser…",
    "alert.error":     "Fejl",
    "alert.saved":     "Gemt.",
    "alert.deleted":   "Slettet.",
    "alert.no_access": "Din rolle har ikke adgang til denne side.",

    // ── Register ─────────────────────────────────────────────────────────────
    "reg.title":            "Registrér endpoint",
    "reg.sub_template":     "Vælg skabelon, scan MAC og indsend.",
    "reg.sub_normal":       "Scan eller indtast MAC og indsend.",
    "reg.logout":           "Log ud",
    "reg.label_template":   "📋 Skabelon",
    "reg.template_none":    "— ingen skabelon —",
    "reg.template_select":  "— vælg skabelon —",
    "reg.no_templates":     "Ingen skabeloner tilgængelige",
    "reg.no_templates_msg": "Ingen skabeloner er tilgængelige for din konto — kontakt administrator.",
    "reg.label_mac":        "MAC-adresse",
    "reg.label_group":      "Identity Group",
    "reg.group_none":       "— ingen (ISE default) —",
    "reg.label_roles":      "System adm",
    "reg.roles_hint":       "Vælg System adm fra kataloget. Hvis ingen vælges, tagges endpointet med dit brugernavn (din egen System adm-rolle).",
    "reg.psk_mode_label":   "PSK Mode",
    "reg.psk_mode_cb":      "MPSK/IPSK aktiveret",
    "reg.psk_key_label":    "PSK Key",
    "reg.optional":         "(valgfri)",
    "reg.btn_show":         "Vis",
    "reg.btn_hide":         "Skjul",
    "reg.btn_generate":     "Generer",
    "reg.label_desc":       "Beskrivelse",
    "reg.btn_submit":       "Registrér",
    "reg.btn_submitting":   "Registrerer…",
    "reg.attr_select":      "— vælg —",
    "reg.attr_type":        "Type",
    "reg.attr_owner":       "Ejer",
    "reg.attr_lokation":    "Lokation",
    "reg.attr_authzvlan":   "Authz VLAN",
    "reg.attr_authzacl":    "Authz ACL",
    "reg.attr_platform":    "Platform",
    "reg.mine_label":       "Mine endpoints",
    "reg.mine_loading":     "Mine endpoints (henter…)",
    "reg.mine_count":       "Mine endpoints ({n})",
    "reg.mine_empty":       "Ingen endpoints synlige for dig.",
    "reg.mine_key_group":   "Gruppe",
    "reg.mine_key_desc":    "Beskr.",
    "reg.mine_key_roles":   "System adm",
    "reg.vendor_unknown":   "Ukendt vendor",
    "reg.apply_platform":   "Sæt Platform={p}",
    "reg.platform_set":     "✓ Sat",
    "reg.queue_send":       "Send nu",
    "reg.err_invalid_mac":  "Ugyldig MAC-adresse.",
    "reg.err_no_template":  "Vælg en skabelon inden registrering.",
    "reg.err_groups":       "Kunne ikke hente groups: {msg}",
    "reg.err_attrs":        "Kunne ikke hente attributter: {msg}",
    "reg.err_psk":          "Kunne ikke generere nøgle: {msg}",
    "reg.err_camera":       "Kamera kunne ikke startes: {msg}",
    "reg.err_fetch_mine":   "Kunne ikke hente: {msg}",
    "reg.err_generic":      "Fejl: {msg}",
    "reg.success":          "✓ {mac} oprettet",
    "reg.offline":          "Offline — {mac} er gemt i kø og sendes når der er forbindelse.",
    "reg.queue_n":          "{n} registrering(er) venter på at blive sendt…",
    "reg.queue_sent":       "Sendte {n} fra kø.",
    "reg.queue_failed":     "{n} fra kø blev afvist af serveren.",
    "reg.scan_cancel":      "Annuller",
    "reg.scan_status":      "Peg kameraet på en MAC-stregkode eller QR…",
    "reg.scan_no_detector": "Browseren understøtter ikke scanning.",
    "reg.scan_no_formats":  "Ingen understøttede barcode-formater.",

    // ── Import ────────────────────────────────────────────────────────────────
    "import.title":             "Import fra CSV",
    "import.label_file":        "CSV fil",
    "import.label_paste":       "...eller indsæt CSV indhold direkte",
    "import.label_fallback":    "Fallback endpoint group",
    "import.label_conflict":    "Ved eksisterende endpoint",
    "import.conflict_skip":     "Skip (behold på ISE som det er)",
    "import.conflict_overwrite":"Overskriv (erstat beskrivelse, gruppe og custom attributes)",
    "import.btn_preview":       "Preview",
    "import.btn_import":        "Import",
    "import.no_rows":           "Ingen rækker fundet.",
    "import.format_ise":        "ISE CSV",
    "import.format_simple":     "Simpelt",
    "import.col_status":        "Status",
    "import.invalid_mac":       "ugyldig MAC",
    "import.err_groups":        "Kunne ikke hente groups: {msg}",
    "import.mode_skip":         "skipper eksisterende",
    "import.mode_overwrite":    "overskriver eksisterende",
    "import.importing":         "Importerer {n} endpoints ({mode})...",
    "import.err_bulk":          "Bulk import fejlede: {msg}",
    "import.result_created":    "Oprettet",
    "import.result_overwritten":"overskrevet",
    "import.result_skipped":    "skipped (fandtes allerede)",
    "import.result_failed":     "fejlet",
    "import.none":              "(ingen)",

    // ── Attributes ────────────────────────────────────────────────────────────
    "attr.title":              "Custom attributter",
    "attr.hint":               "Administrér de tilladte værdier for hvert custom attribut. Værdierne bruges i dropdowns ved oprettelse og redigering af endpoints.",
    "attr.label_type":         "Type",
    "attr.label_owner":        "Ejer (Owner)",
    "attr.label_lokation":     "Lokation",
    "attr.label_authzvlan":    "Authz VLAN",
    "attr.label_platformtype": "Platform-type (lokale labels)",
    "attr.no_values":          "Ingen værdier endnu.",
    "attr.del_title":          "Fjern",
    "attr.del_confirm":        "Fjern \"{v}\" fra {attr}?\n\nAlle ISE-endpoints der har denne værdi i {attr} vil også få feltet ryddet (sat til tomt). Dette kan tage et stykke tid ved mange endpoints.",
    "attr.del_deleting":       "Sletter \"{v}\" og rydder feltet på berørte ISE-endpoints...",
    "attr.del_success":        "Fjernet \"{v}\" fra {attr}. Scannet {scanned} endpoints, ryddet {cleared} i ISE.",
    "attr.input_placeholder":  "Ny værdi...",
    "attr.btn_add":            "Tilføj",
    "attr.mapping_title":      "Raw → lokal mapping (1-til-1)",
    "attr.mapping_hint":       "Hver ISE-raw-værdi bindes til ét lokalt label og en CoA-metode. MnT-sync skriver det lokale label til endpoint; CoA-on-save bruger den valgte metode.",
    "attr.mapping_col_raw":    "ISE raw",
    "attr.mapping_col_local":  "Lokalt label",
    "attr.mapping_col_coa":    "CoA-metode",
    "attr.mapping_none":       "— ingen —",
    "attr.mapping_save":       "Gem mapping",
    "attr.mapping_saving":     "Gemmer...",
    "attr.mapping_saved":      "Gemt.",
    "attr.mapping_error":      "Fejl: {msg}",
    "attr.sync_btn":           "Sync platform fra MnT",
    "attr.sync_overwrite":     "Overskriv eksisterende",
    "attr.sync_hint":          "MnT sender raw-værdier (airos, iosxe, ...) som oversættes til de lokale labels via mapping nedenfor.",
    "attr.sync_loading":       "Henter aktive sessions fra MnT og deriverer platform...",
    "attr.sync_unmapped":      "Ikke-mappede raw-værdier sprunget over: {vals} ({n} endpoints). Tilføj dem i mapping nedenfor og kør igen.",

    // ── DACLs ─────────────────────────────────────────────────────────────────
    "dacl.title":               "ACL — Cisco ISE Downloadable ACLs",
    "dacl.btn_new":             "Ny ACL",
    "dacl.btn_refresh":         "Refresh",
    "dacl.filter_placeholder":  "Filter...",
    "dacl.list_empty":          "Ingen DACL'er.",
    "dacl.list_loading":        "Indlæser fra ISE...",
    "dacl.editor_empty":        "Vælg en ACL til venstre eller klik Ny ACL.",
    "dacl.label_name":          "Navn",
    "dacl.name_hint":           "Bogstaver, tal, _ og -. Kan ikke ændres efter oprettelse.",
    "dacl.label_description":   "Beskrivelse",
    "dacl.label_type":          "Type",
    "dacl.label_body":          "Access-list (Cisco IOS syntaks)",
    "dacl.btn_create":          "Opret",
    "dacl.btn_save":            "Gem ændringer",
    "dacl.btn_cancel":          "Annuller",
    "dacl.btn_delete":          "Slet ACL",
    "dacl.syntax_ok":           "Syntaks OK.",
    "dacl.validation_errors":   "{n} fejl, {w} advarsler",
    "dacl.validation_warnings": "{w} advarsler (ingen fejl)",
    "dacl.issue_line":          "linje {n}",
    "dacl.saving":              "Gemmer i ISE...",
    "dacl.saved":               "ACL \"{name}\" gemt.",
    "dacl.deleting":            "Sletter...",
    "dacl.deleted":             "ACL slettet.",
    "dacl.err_name_required":   "Navn er påkrævet.",
    "dacl.err_validation":      "Validering fejlede: {msg}",
    "dacl.confirm_discard":     "Du har ugemte ændringer. Forkast og opret ny?",
    "dacl.confirm_discard_open":"Du har ugemte ændringer. Forkast og åbn anden ACL?",
    "dacl.confirm_delete":      "Slet ACL \"{name}\" i ISE?\n\nEndpoints der refererer til navnet via AuthzACL bliver IKKE automatisk ryddet — de vil bare miste opslag indtil navnet eksisterer igen.",

    // ── Audit ─────────────────────────────────────────────────────────────────
    "audit.title":                    "Audit-log",
    "audit.hint":                     "Append-only log af alle skrive-operationer. Admins kan rulle Endpoints og DACL'er tilbage til tidligere tilstand; rollbacks bliver selv logget, så historikken forbliver komplet.",
    "audit.label_resource":           "Ressource",
    "audit.all_resources":            "Alle",
    "audit.label_search":             "Søg",
    "audit.search_placeholder":       "aktør, id, MAC, JSON, IP, dato…",
    "audit.label_count":              "Antal",
    "audit.btn_refresh":              "Opdater",
    "audit.col_time":                 "Tidspunkt",
    "audit.col_actor":                "Aktør",
    "audit.col_action":               "Handling",
    "audit.col_resource":             "Ressource",
    "audit.col_id":                   "ID",
    "audit.col_details":              "Detaljer",
    "audit.loading":                  "Henter…",
    "audit.no_events":                "Ingen events matcher filtrene.",
    "audit.btn_view":                 "Vis",
    "audit.btn_rollback":             "Rollback",
    "audit.btn_rollback_confirm":     "Rul tilbage",
    "audit.drawer_before":            "Før",
    "audit.drawer_after":             "Efter",
    "audit.drawer_time":              "Tidspunkt:",
    "audit.drawer_actor":             "Aktør:",
    "audit.drawer_close":             "Luk",
    "audit.none":                     "(ingen)",
    "audit.confirm_rollback":         "Rul audit-event #{id} tilbage? Handlingen logges som et nyt event.",
    "audit.rollback_error":           "Rollback fejlede: {msg}",
    "audit.action_created":           "Oprettet",
    "audit.action_updated":           "Opdateret",
    "audit.action_deleted":           "Slettet",
    "audit.action_value_added":       "Værdi tilføjet",
    "audit.action_value_removed":     "Værdi fjernet",
    "audit.action_mapping_updated":   "Mapping opdateret",
    "audit.action_password_changed":  "Password ændret",
    "audit.action_rolled_back":       "Rullet tilbage",

    // ── Logs ──────────────────────────────────────────────────────────────────
    "logs.title":             "Log",
    "logs.hint":              "Viser entries fra backend-loggen (backend/logs/app.log) — nyeste øverst.",
    "logs.label_level":       "Niveau",
    "logs.all_levels":        "Alle",
    "logs.label_lines":       "Linjer",
    "logs.label_search":      "Søg",
    "logs.search_placeholder":"fritekst (MAC, logger, besked…)",
    "logs.btn_refresh":       "Opdater",
    "logs.col_time":          "Tidspunkt",
    "logs.col_level":         "Niveau",
    "logs.col_logger":        "Logger",
    "logs.col_msg":           "Besked",
    "logs.loading":           "Henter…",
    "logs.no_entries":        "Ingen entries matcher filtrene.",

    // ── Metrics ───────────────────────────────────────────────────────────────
    "metrics.title":           "Metrics",
    "metrics.hint":            "Live Prometheus-data fra backend. Tæller akkumuleres fra seneste genstart — absolutte totaler, ikke rate per sekund. Auto-opdaterer hvert 15 sek.",
    "metrics.btn_refresh":     "Opdater nu",
    "metrics.last_updated":    "Sidst opdateret: ",
    "metrics.loading":         "Henter…",
    "metrics.error":           "Kunne ikke hente metrics: {msg}",
    "metrics.card_cb":         "Circuit Breaker",
    "metrics.card_ise":        "ISE API",
    "metrics.card_cache":      "Cache",
    "metrics.card_rate":       "Rate Limiter",
    "metrics.card_bulk":       "Bulk-operationer",
    "metrics.total_requests":  "Total requests",
    "metrics.successful_2xx":  "Succesful (2xx)",
    "metrics.errors_4xx":      "4xx fejl",
    "metrics.errors_5xx":      "5xx fejl",
    "metrics.transport_errors":"Transport-fejl",
    "metrics.retries":         "Retries",
    "metrics.avg_response":    "Gennemsn. svartid",
    "metrics.cache_entries":   "Entries i hukommelse",
    "metrics.cache_hits":      "Hits",
    "metrics.cache_misses":    "Misses",
    "metrics.cache_stale":     "Stale-while-revalidate",
    "metrics.cache_evictions": "Evictions (FIFO)",
    "metrics.cache_disk_stale":"Disk-stale ved opstart",
    "metrics.rate_blocked":    "Blokerede requests (429)",
    "metrics.bulk_created":    "Oprettet",
    "metrics.bulk_overwritten":"Overskrevet",
    "metrics.bulk_skipped":    "Sprunget over",
    "metrics.bulk_failed":     "Fejlet",
    "metrics.cb_closed":       "CLOSED",
    "metrics.cb_halfopen":     "HALF-OPEN",
    "metrics.cb_open":         "OPEN",
    "metrics.hit_rate":        "hit-rate",

    // ── Browse — toolbar tooltips ─────────────────────────────────────────────
    "browse.tooltip_data":      "Data-handlinger",
    "browse.tooltip_columns":   "Vis/skjul kolonner",
    "browse.tooltip_filters":   "Filtre",
    "browse.tooltip_save":      "Gem-handlinger",
    "browse.tooltip_selection": "Handlinger på valgte rækker",
    "browse.tooltip_view":      "Visning",

    // ── Browse — pxGrid badge ─────────────────────────────────────────────────
    "browse.pxgrid_push":       "🟢 PUSH (pxGrid · {n} aktive · sidste session-event {ago} siden){ep}",
    "browse.pxgrid_pull":       "🟡 PULL (MnT-poll · {n} aktive){ep}",
    "browse.pxgrid_inactive":   "⚪ inaktiv (intet filter + pxGrid offline){ep}",
    "browse.pxgrid_ep_part":    " · endpoint-events: {n}{agopart}",
    "browse.pxgrid_ep_ago":     " (sidst {ago} siden)",

    // ── Browse — dynamiske strenge ────────────────────────────────────────────
    "browse.save_all_n":           "Gem alle ({n})",
    "browse.selection_n":          "{n} valgt",
    "browse.page_info":            "Side {page} af {total} ({count} total)",
    "browse.filtered_info":        "{filtered} / {all} endpoints (filtreret)",
    "browse.all_info":             "{n} endpoints",
    "browse.server_info":          "{n} / {total} endpoints",
    "browse.fetching_ise":         "Henter detaljer fra ISE...",
    "browse.saving_n":             "Gemmer {n} ændrede endpoints...",
    "browse.saving_selected_n":    "Gemmer {n} endpoints...",
    "browse.coa_n":                "Udløser CoA for {n} endpoints...",
    "browse.saved_n":              "{n} gemt",
    "browse.failed_n":             "{n} fejlede",
    "browse.refreshing":           "Opdaterer…",
    "browse.export_fetching":      "Henter alle endpoints fra ISE for export...",
    "browse.export_error":         "Kunne ikke hente alle endpoints: {msg}",
    "browse.export_none":          "Ingen endpoints at eksportere.",
    "browse.export_done_selected": "Eksporteret {n} valgte endpoints.",
    "browse.export_done_all":      "Eksporteret {n} endpoints (alle).",
    "browse.export_done_filtered": "Eksporteret {n} endpoints.",

    // ── App ───────────────────────────────────────────────────────────────────
    "app.status_ok":    "ok",
    "app.status_down":  "down",
    "app.no_access":    "Din rolle (<b>{role}</b>) har ikke adgang til denne side.",

    // ── CSV Template ──────────────────────────────────────────────────────────
    "csv_tpl.title":          "CSV Export Skabelon",
    "csv_tpl.hint":           "Definerer hvilke kolonner der inkluderes ved CSV-eksport fra Browse view. Importér en CSV-fil (kun header-rækken bruges) for at sætte en ny skabelon.",
    "csv_tpl.active_prefix":  "Aktiv skabelon (",
    "csv_tpl.active_suffix":  " kolonner)",
    "csv_tpl.import_label":   "Importér skabelon fra CSV-fil",
    "csv_tpl.btn_reset":      "Nulstil til standard",
    "csv_tpl.err_no_cols":    "Ingen kolonner fundet i filen — kontrollér at første linje er en header-række.",
    "csv_tpl.err_read":       "Kunne ikke læse filen: {msg}",
    "csv_tpl.imported":       "Skabelon importeret — {n} kolonner{extra}. Fremtidige exports bruger denne skabelon.",
    "csv_tpl.portal_added":   " (+{n} portal-kolonner tilføjet)",
    "csv_tpl.reset_done":     "Skabelon nulstillet til standard ({n} kolonner).",

    // ── Attributes — CoA ─────────────────────────────────────────────────────
    "attr.coa_reauth":    "CoA Reauth",
    "attr.coa_disconnect":"CoA Disconnect",
  },

  en: {
    // Navigation
    "nav.browse":       "Browse",
    "nav.register":     "Register",
    "nav.import":       "Import",
    "nav.attributes":   "Attributes",
    "nav.dacls":        "DACLs",
    "nav.logs":         "Logs",
    "nav.audit":        "Audit",
    "nav.metrics":      "Metrics",
    "nav.settings":     "Settings",
    "nav.user-prefs":   "Preferences",
    "nav.csv-template": "CSV Template",

    // Common buttons / labels
    "btn.save":    "Save",
    "btn.cancel":  "Cancel",
    "btn.delete":  "Delete",
    "btn.edit":    "Edit",
    "btn.search":  "Search",
    "btn.refresh": "Refresh",
    "btn.export":  "Export CSV",
    "btn.close":   "Close",
    "btn.confirm": "Confirm",
    "btn.create":  "Create",
    "btn.yes":     "Yes",
    "btn.no":      "No",

    // Login
    "login.title":        "Log in",
    "login.setup_title":  "First-time setup",
    "login.username":     "Username",
    "login.password":     "Password",
    "login.password2":    "Confirm password",
    "login.submit":       "Log in",
    "login.setup_submit": "Create admin & log in",
    "login.setup_hint":   "No users exist yet. Create an administrator to get started.",
    "login.err_backend":  "Cannot reach backend",
    "login.err_pw_match": "Passwords do not match",

    // Browse — toolbar
    "browse.title":              "Browse / Edit endpoints",
    "browse.btn_refresh":        "Refresh",
    "browse.btn_export":         "Export CSV",
    "browse.btn_columns":        "Columns ▾",
    "browse.btn_views":          "📁 Views ▾",
    "browse.btn_portal_filter":  "Portal only",
    "browse.btn_coa_off":        "CoA reauth: OFF",
    "browse.btn_coa_on":         "CoA reauth: ON",
    "browse.btn_save_all":       "Save all",
    "browse.btn_bulk_edit":      "Edit selected",
    "browse.btn_bulk_save":      "Save selected",
    "browse.btn_bulk_disconnect":"Disconnect",
    "browse.btn_bulk_delete":    "Delete",
    "browse.label_show":         "Show",
    "browse.select_all_title":   "Select all",
    "browse.pxgrid_badge":       "⚪ Auth-status: unknown",
    "browse.pxgrid_badge_title": "Where auth-status comes from: pxGrid push (live) or MnT pull (5-15s delay)",

    // Browse — table states
    "browse.no_results":        "No results",
    "browse.loading_rows":      "Loading...",
    "browse.page_prev":         "Previous",
    "browse.page_next":         "Next",
    "browse.mac_link_title":    "View details",
    "browse.stale_badge_title": "Data from old cache — updating in background",
    "browse.extern_role_title": "User tag or role outside catalog",

    // Browse — column names
    "col.mac":          "MAC",
    "col.vendor":       "Vendor",
    "col.group_name":   "Identity Group",
    "col.static_group": "Assignment",
    "col.description":  "Description",
    "col.endpoint_type":"Type",
    "col.owner":        "Owner",
    "col.lokation":     "Location",
    "col.platform_type":"Platform",
    "col.psk_mode":     "PSK Mode",
    "col.psk_key":      "PSK Key",
    "col.authz_vlan":   "AuthzVlan",
    "col.authz_acl":    "AuthzACL",
    "col.roles":        "System adm",
    "col.create_time":  "Age",

    // Browse — cell values
    "cell.static":   "Static",
    "cell.dynamic":  "Dynamic",
    "cell.yes":      "Yes",
    "cell.no_group": "— none —",

    // Browse — age formatting
    "age.today":     "Today",
    "age.yesterday": "Yesterday",
    "age.days":      "days",
    "age.months":    "mo.",
    "age.years":     "yr.",

    // Browse — detail modal
    "detail.title":          "Endpoint details",
    "detail.assignment":     "Assignment",
    "detail.static_assign":  "Static group assignment",
    "detail.psk_mode_lbl":   "MPSK/IPSK enabled",
    "detail.profile_name":   "Profile name",
    "detail.registered":     "Registered",
    "detail.last_updated":   "Last updated",
    "detail.anc_free":       "Free",
    "detail.anc_quarantine": "Quarantine",
    "detail.anc_clear":      "Clear quarantine",
    "detail.anc_loading":    "Fetching status…",
    "detail.anc_select":     "— Select ANC policy —",
    "detail.btn_save":       "Save changes",
    "detail.btn_disconnect": "Disconnect",
    "detail.btn_close":      "Close",
    "detail.btn_show":       "Show",
    "detail.btn_hide":       "Hide",
    "detail.btn_generate":   "Generate",

    // Browse — bulk edit modal
    "bulk.title":             "Edit selected endpoints",
    "bulk.count_suffix":      "endpoints selected",
    "bulk.btn_apply":         "Apply",
    "bulk.btn_cancel":        "Cancel",
    "bulk.btn_show":          "Show",
    "bulk.btn_hide":          "Hide",
    "bulk.btn_generate":      "Generate",
    "bulk.updated_local":     "endpoints updated locally — press \"Save all\" or \"Save selected\" to save to ISE.",
    "bulk.deleting":          "Deleting",
    "bulk.deleted":           "deleted",
    "bulk.failed":            "failed",
    "bulk.confirm_delete":    "Delete {n} endpoints?\n\n{macs}",
    "bulk.confirm_disconnect":"CoA Disconnect {n} client(s)?\n\n{macs}\n\nThey will be de-authenticated on the WLC/switch and must re-associate.",

    // User-prefs
    "prefs.title":           "Preferences",
    "prefs.pw_card":         "Change your password",
    "prefs.pw_logged_in_as": "Logged in as",
    "prefs.pw_role":         "role",
    "prefs.pw_current":      "Current password",
    "prefs.pw_new":          "New password (min. 8 chars)",
    "prefs.pw_new2":         "Confirm new password",
    "prefs.pw_submit":       "Change password",
    "prefs.pw_success":      "Password changed.",
    "prefs.pw_err_match":    "The two new passwords do not match.",
    "prefs.pw_tacacs_hint":  "Password is managed by the TACACS+ server — it cannot be changed here.",
    "prefs.pw_tacacs_via":   "via",
    "prefs.frontend_card":   "Frontend preferences",
    "prefs.frontend_hint":   "Saved in your browser and synced with the server.",
    "prefs.page_size":       "Default page size (browse view)",
    "prefs.theme":           "Theme",
    "prefs.language":        "Language",
    "prefs.lang_auto":       "Automatic (portal default)",
    "prefs.lang_da":         "Dansk",
    "prefs.lang_en":         "English",
    "prefs.theme_light":     "Light",
    "prefs.theme_dark":      "Dark",
    "prefs.theme_midnight":  "Midnight",
    "prefs.theme_slate":     "Slate",
    "prefs.submit":          "Save preferences",
    "prefs.success":         "Preferences saved.",

    // Settings — locale panel
    "settings.locale_card":    "Portal language",
    "settings.locale_hint":    "Default language for users without a personal language selection.",
    "settings.locale_label":   "Default language",
    "settings.locale_submit":  "Save language setting",
    "settings.locale_success": "Language setting saved.",

    // General alert texts
    "alert.loading":   "Loading…",
    "alert.error":     "Error",
    "alert.saved":     "Saved.",
    "alert.deleted":   "Deleted.",
    "alert.no_access": "Your role does not have access to this page.",

    // ── Register ─────────────────────────────────────────────────────────────
    "reg.title":            "Register endpoint",
    "reg.sub_template":     "Choose template, scan MAC and submit.",
    "reg.sub_normal":       "Scan or enter MAC and submit.",
    "reg.logout":           "Log out",
    "reg.label_template":   "📋 Template",
    "reg.template_none":    "— no template —",
    "reg.template_select":  "— select template —",
    "reg.no_templates":     "No templates available",
    "reg.no_templates_msg": "No templates available for your account — contact administrator.",
    "reg.label_mac":        "MAC address",
    "reg.label_group":      "Identity Group",
    "reg.group_none":       "— none (ISE default) —",
    "reg.label_roles":      "System adm",
    "reg.roles_hint":       "Choose system admin from catalog. If none selected, endpoint is tagged with your username (your own admin role).",
    "reg.psk_mode_label":   "PSK Mode",
    "reg.psk_mode_cb":      "MPSK/IPSK enabled",
    "reg.psk_key_label":    "PSK Key",
    "reg.optional":         "(optional)",
    "reg.btn_show":         "Show",
    "reg.btn_hide":         "Hide",
    "reg.btn_generate":     "Generate",
    "reg.label_desc":       "Description",
    "reg.btn_submit":       "Register",
    "reg.btn_submitting":   "Registering…",
    "reg.attr_select":      "— select —",
    "reg.attr_type":        "Type",
    "reg.attr_owner":       "Owner",
    "reg.attr_lokation":    "Location",
    "reg.attr_authzvlan":   "Authz VLAN",
    "reg.attr_authzacl":    "Authz ACL",
    "reg.attr_platform":    "Platform",
    "reg.mine_label":       "My endpoints",
    "reg.mine_loading":     "My endpoints (loading…)",
    "reg.mine_count":       "My endpoints ({n})",
    "reg.mine_empty":       "No endpoints visible to you.",
    "reg.mine_key_group":   "Group",
    "reg.mine_key_desc":    "Desc.",
    "reg.mine_key_roles":   "System adm",
    "reg.vendor_unknown":   "Unknown vendor",
    "reg.apply_platform":   "Set Platform={p}",
    "reg.platform_set":     "✓ Set",
    "reg.queue_send":       "Send now",
    "reg.err_invalid_mac":  "Invalid MAC address.",
    "reg.err_no_template":  "Select a template before registering.",
    "reg.err_groups":       "Could not fetch groups: {msg}",
    "reg.err_attrs":        "Could not fetch attributes: {msg}",
    "reg.err_psk":          "Could not generate key: {msg}",
    "reg.err_camera":       "Camera could not be started: {msg}",
    "reg.err_fetch_mine":   "Could not fetch: {msg}",
    "reg.err_generic":      "Error: {msg}",
    "reg.success":          "✓ {mac} created",
    "reg.offline":          "Offline — {mac} queued and will be sent when connectivity is restored.",
    "reg.queue_n":          "{n} registration(s) waiting to be sent…",
    "reg.queue_sent":       "Sent {n} from queue.",
    "reg.queue_failed":     "{n} from queue rejected by server.",
    "reg.scan_cancel":      "Cancel",
    "reg.scan_status":      "Point camera at a MAC barcode or QR code…",
    "reg.scan_no_detector": "Browser does not support scanning.",
    "reg.scan_no_formats":  "No supported barcode formats.",

    // ── Import ────────────────────────────────────────────────────────────────
    "import.title":             "Import from CSV",
    "import.label_file":        "CSV file",
    "import.label_paste":       "...or paste CSV content directly",
    "import.label_fallback":    "Fallback endpoint group",
    "import.label_conflict":    "On existing endpoint",
    "import.conflict_skip":     "Skip (keep in ISE as-is)",
    "import.conflict_overwrite":"Overwrite (replace description, group and custom attributes)",
    "import.btn_preview":       "Preview",
    "import.btn_import":        "Import",
    "import.no_rows":           "No rows found.",
    "import.format_ise":        "ISE CSV",
    "import.format_simple":     "Simple",
    "import.col_status":        "Status",
    "import.invalid_mac":       "invalid MAC",
    "import.err_groups":        "Could not fetch groups: {msg}",
    "import.mode_skip":         "skipping existing",
    "import.mode_overwrite":    "overwriting existing",
    "import.importing":         "Importing {n} endpoints ({mode})...",
    "import.err_bulk":          "Bulk import failed: {msg}",
    "import.result_created":    "Created",
    "import.result_overwritten":"overwritten",
    "import.result_skipped":    "skipped (already existed)",
    "import.result_failed":     "failed",
    "import.none":              "(none)",

    // ── Attributes ────────────────────────────────────────────────────────────
    "attr.title":              "Custom attributes",
    "attr.hint":               "Manage the allowed values for each custom attribute. The values are used in dropdowns when creating and editing endpoints.",
    "attr.label_type":         "Type",
    "attr.label_owner":        "Owner",
    "attr.label_lokation":     "Location",
    "attr.label_authzvlan":    "Authz VLAN",
    "attr.label_platformtype": "Platform type (local labels)",
    "attr.no_values":          "No values yet.",
    "attr.del_title":          "Remove",
    "attr.del_confirm":        "Remove \"{v}\" from {attr}?\n\nAll ISE endpoints that have this value in {attr} will also have the field cleared (set to empty). This may take a while with many endpoints.",
    "attr.del_deleting":       "Deleting \"{v}\" and clearing field on affected ISE endpoints...",
    "attr.del_success":        "Removed \"{v}\" from {attr}. Scanned {scanned} endpoints, cleared {cleared} in ISE.",
    "attr.input_placeholder":  "New value...",
    "attr.btn_add":            "Add",
    "attr.mapping_title":      "Raw → local mapping (1-to-1)",
    "attr.mapping_hint":       "Each ISE raw value is bound to one local label and a CoA method. MnT-sync writes the local label to the endpoint; CoA-on-save uses the selected method.",
    "attr.mapping_col_raw":    "ISE raw",
    "attr.mapping_col_local":  "Local label",
    "attr.mapping_col_coa":    "CoA method",
    "attr.mapping_none":       "— none —",
    "attr.mapping_save":       "Save mapping",
    "attr.mapping_saving":     "Saving...",
    "attr.mapping_saved":      "Saved.",
    "attr.mapping_error":      "Error: {msg}",
    "attr.sync_btn":           "Sync platform from MnT",
    "attr.sync_overwrite":     "Overwrite existing",
    "attr.sync_hint":          "MnT sends raw values (airos, iosxe, ...) which are translated to local labels via the mapping below.",
    "attr.sync_loading":       "Fetching active sessions from MnT and deriving platform...",
    "attr.sync_unmapped":      "Unmapped raw values skipped: {vals} ({n} endpoints). Add them in the mapping below and run again.",

    // ── DACLs ─────────────────────────────────────────────────────────────────
    "dacl.title":               "ACL — Cisco ISE Downloadable ACLs",
    "dacl.btn_new":             "New ACL",
    "dacl.btn_refresh":         "Refresh",
    "dacl.filter_placeholder":  "Filter...",
    "dacl.list_empty":          "No DACLs.",
    "dacl.list_loading":        "Loading from ISE...",
    "dacl.editor_empty":        "Select an ACL on the left or click New ACL.",
    "dacl.label_name":          "Name",
    "dacl.name_hint":           "Letters, numbers, _ and -. Cannot be changed after creation.",
    "dacl.label_description":   "Description",
    "dacl.label_type":          "Type",
    "dacl.label_body":          "Access list (Cisco IOS syntax)",
    "dacl.btn_create":          "Create",
    "dacl.btn_save":            "Save changes",
    "dacl.btn_cancel":          "Cancel",
    "dacl.btn_delete":          "Delete ACL",
    "dacl.syntax_ok":           "Syntax OK.",
    "dacl.validation_errors":   "{n} errors, {w} warnings",
    "dacl.validation_warnings": "{w} warnings (no errors)",
    "dacl.issue_line":          "line {n}",
    "dacl.saving":              "Saving to ISE...",
    "dacl.saved":               "ACL \"{name}\" saved.",
    "dacl.deleting":            "Deleting...",
    "dacl.deleted":             "ACL deleted.",
    "dacl.err_name_required":   "Name is required.",
    "dacl.err_validation":      "Validation failed: {msg}",
    "dacl.confirm_discard":     "You have unsaved changes. Discard and create new?",
    "dacl.confirm_discard_open":"You have unsaved changes. Discard and open another ACL?",
    "dacl.confirm_delete":      "Delete ACL \"{name}\" in ISE?\n\nEndpoints referencing the name via AuthzACL will NOT be automatically cleared — they will just lose lookups until the name exists again.",

    // ── Audit ─────────────────────────────────────────────────────────────────
    "audit.title":                   "Audit log",
    "audit.hint":                    "Append-only log of all write operations. Admins can roll back Endpoints and DACLs to a previous state; rollbacks are themselves logged so the history remains complete.",
    "audit.label_resource":          "Resource",
    "audit.all_resources":           "All",
    "audit.label_search":            "Search",
    "audit.search_placeholder":      "actor, id, MAC, JSON, IP, date…",
    "audit.label_count":             "Count",
    "audit.btn_refresh":             "Refresh",
    "audit.col_time":                "Timestamp",
    "audit.col_actor":               "Actor",
    "audit.col_action":              "Action",
    "audit.col_resource":            "Resource",
    "audit.col_id":                  "ID",
    "audit.col_details":             "Details",
    "audit.loading":                 "Loading…",
    "audit.no_events":               "No events match the filters.",
    "audit.btn_view":                "View",
    "audit.btn_rollback":            "Rollback",
    "audit.btn_rollback_confirm":    "Roll back",
    "audit.drawer_before":           "Before",
    "audit.drawer_after":            "After",
    "audit.drawer_time":             "Timestamp:",
    "audit.drawer_actor":            "Actor:",
    "audit.drawer_close":            "Close",
    "audit.none":                    "(none)",
    "audit.confirm_rollback":        "Roll back audit event #{id}? The action will be logged as a new event.",
    "audit.rollback_error":          "Rollback failed: {msg}",
    "audit.action_created":          "Created",
    "audit.action_updated":          "Updated",
    "audit.action_deleted":          "Deleted",
    "audit.action_value_added":      "Value added",
    "audit.action_value_removed":    "Value removed",
    "audit.action_mapping_updated":  "Mapping updated",
    "audit.action_password_changed": "Password changed",
    "audit.action_rolled_back":      "Rolled back",

    // ── Logs ──────────────────────────────────────────────────────────────────
    "logs.title":             "Log",
    "logs.hint":              "Shows entries from the backend log (backend/logs/app.log) — newest first.",
    "logs.label_level":       "Level",
    "logs.all_levels":        "All",
    "logs.label_lines":       "Lines",
    "logs.label_search":      "Search",
    "logs.search_placeholder":"free text (MAC, logger, message…)",
    "logs.btn_refresh":       "Refresh",
    "logs.col_time":          "Timestamp",
    "logs.col_level":         "Level",
    "logs.col_logger":        "Logger",
    "logs.col_msg":           "Message",
    "logs.loading":           "Loading…",
    "logs.no_entries":        "No entries match the filters.",

    // ── Metrics ───────────────────────────────────────────────────────────────
    "metrics.title":           "Metrics",
    "metrics.hint":            "Live Prometheus data from backend. Counters accumulate from last restart — absolute totals, not rate per second. Auto-refreshes every 15 sec.",
    "metrics.btn_refresh":     "Refresh now",
    "metrics.last_updated":    "Last updated: ",
    "metrics.loading":         "Loading…",
    "metrics.error":           "Could not fetch metrics: {msg}",
    "metrics.card_cb":         "Circuit Breaker",
    "metrics.card_ise":        "ISE API",
    "metrics.card_cache":      "Cache",
    "metrics.card_rate":       "Rate Limiter",
    "metrics.card_bulk":       "Bulk operations",
    "metrics.total_requests":  "Total requests",
    "metrics.successful_2xx":  "Successful (2xx)",
    "metrics.errors_4xx":      "4xx errors",
    "metrics.errors_5xx":      "5xx errors",
    "metrics.transport_errors":"Transport errors",
    "metrics.retries":         "Retries",
    "metrics.avg_response":    "Avg. response time",
    "metrics.cache_entries":   "Entries in memory",
    "metrics.cache_hits":      "Hits",
    "metrics.cache_misses":    "Misses",
    "metrics.cache_stale":     "Stale-while-revalidate",
    "metrics.cache_evictions": "Evictions (FIFO)",
    "metrics.cache_disk_stale":"Disk-stale at startup",
    "metrics.rate_blocked":    "Blocked requests (429)",
    "metrics.bulk_created":    "Created",
    "metrics.bulk_overwritten":"Overwritten",
    "metrics.bulk_skipped":    "Skipped",
    "metrics.bulk_failed":     "Failed",
    "metrics.cb_closed":       "CLOSED",
    "metrics.cb_halfopen":     "HALF-OPEN",
    "metrics.cb_open":         "OPEN",
    "metrics.hit_rate":        "hit-rate",

    // ── Browse — toolbar tooltips ─────────────────────────────────────────────
    "browse.tooltip_data":      "Data actions",
    "browse.tooltip_columns":   "Show/hide columns",
    "browse.tooltip_filters":   "Filters",
    "browse.tooltip_save":      "Save actions",
    "browse.tooltip_selection": "Actions on selected rows",
    "browse.tooltip_view":      "View",

    // ── Browse — pxGrid badge ─────────────────────────────────────────────────
    "browse.pxgrid_push":       "🟢 PUSH (pxGrid · {n} active · last session event {ago} ago){ep}",
    "browse.pxgrid_pull":       "🟡 PULL (MnT-poll · {n} active){ep}",
    "browse.pxgrid_inactive":   "⚪ inactive (no filter + pxGrid offline){ep}",
    "browse.pxgrid_ep_part":    " · endpoint-events: {n}{agopart}",
    "browse.pxgrid_ep_ago":     " ({ago} ago)",

    // ── Browse — dynamic strings ──────────────────────────────────────────────
    "browse.save_all_n":           "Save all ({n})",
    "browse.selection_n":          "{n} selected",
    "browse.page_info":            "Page {page} of {total} ({count} total)",
    "browse.filtered_info":        "{filtered} / {all} endpoints (filtered)",
    "browse.all_info":             "{n} endpoints",
    "browse.server_info":          "{n} / {total} endpoints",
    "browse.fetching_ise":         "Fetching details from ISE...",
    "browse.saving_n":             "Saving {n} modified endpoints...",
    "browse.saving_selected_n":    "Saving {n} endpoints...",
    "browse.coa_n":                "Triggering CoA for {n} endpoints...",
    "browse.saved_n":              "{n} saved",
    "browse.failed_n":             "{n} failed",
    "browse.refreshing":           "Refreshing…",
    "browse.export_fetching":      "Fetching all endpoints from ISE for export...",
    "browse.export_error":         "Could not fetch all endpoints: {msg}",
    "browse.export_none":          "No endpoints to export.",
    "browse.export_done_selected": "Exported {n} selected endpoints.",
    "browse.export_done_all":      "Exported {n} endpoints (all).",
    "browse.export_done_filtered": "Exported {n} endpoints.",

    // ── App ───────────────────────────────────────────────────────────────────
    "app.status_ok":    "ok",
    "app.status_down":  "down",
    "app.no_access":    "Your role (<b>{role}</b>) does not have access to this page.",

    // ── CSV Template ──────────────────────────────────────────────────────────
    "csv_tpl.title":          "CSV Export Template",
    "csv_tpl.hint":           "Defines which columns are included when exporting CSV from Browse view. Import a CSV file (only the header row is used) to set a new template.",
    "csv_tpl.active_prefix":  "Active template (",
    "csv_tpl.active_suffix":  " columns)",
    "csv_tpl.import_label":   "Import template from CSV file",
    "csv_tpl.btn_reset":      "Reset to default",
    "csv_tpl.err_no_cols":    "No columns found in file — check that the first line is a header row.",
    "csv_tpl.err_read":       "Could not read file: {msg}",
    "csv_tpl.imported":       "Template imported — {n} columns{extra}. Future exports will use this template.",
    "csv_tpl.portal_added":   " (+{n} portal columns added)",
    "csv_tpl.reset_done":     "Template reset to default ({n} columns).",

    // ── Attributes — CoA ─────────────────────────────────────────────────────
    "attr.coa_reauth":    "CoA Reauth",
    "attr.coa_disconnect":"CoA Disconnect",
  },
};

// Aktiv locale — sættes ved resolveLocale(), ændres ved setLocale()
let _locale = "en";

// Callback der kaldes efter setLocale() for at re-rendre aktuel view
let _rerenderFn = null;

export function registerRerenderCallback(fn) {
  _rerenderFn = fn;
}

export function getLocale() {
  return _locale;
}

/**
 * t(key) — slår nøgle op i aktivt sprog. Falder tilbage til key hvis ukendt.
 */
export function t(key) {
  return (TRANSLATIONS[_locale] || TRANSLATIONS.en)[key] ?? key;
}

/**
 * resolveLocale(portalDefault) — bestemmer startsprog.
 * Kalder GET /api/me/prefs for brugerpræference; falder tilbage i prioritetsrækkefølge.
 * Skal kaldes efter login.
 */
export async function resolveLocale(portalDefault, apiGetMyPrefs) {
  // 1) Forsøg bruger-præference fra server
  try {
    const prefs = await apiGetMyPrefs();
    if (prefs?.language) {
      _locale = prefs.language;
      return;
    }
  } catch { /* ingen server-præference — fortsæt */ }

  // 2) Portal global default (bundlet i AuthStatus)
  if (portalDefault && TRANSLATIONS[portalDefault]) {
    _locale = portalDefault;
    return;
  }

  // 3) Browser-sprog
  const browserLang = (navigator.language || "").toLowerCase().split("-")[0];
  if (TRANSLATIONS[browserLang]) {
    _locale = browserLang;
    return;
  }

  // 4) Hardcoded fallback
  _locale = "en";
}

/**
 * setLocale(lang) — opdaterer locale, gemmer på server, re-renderer aktuel view.
 * language=null → rydder bruger-præference (brug portal/browser default).
 */
export async function setLocale(lang, apiPutMyPrefs) {
  try {
    await apiPutMyPrefs({ language: lang || null });
  } catch (err) {
    // TACACS+-brugere kan ikke gemme server-side — gem i localStorage som fallback
    if (err.message && err.message.includes("403")) {
      try {
        const stored = JSON.parse(localStorage.getItem("ise_portal_prefs") || "{}");
        stored.language = lang || undefined;
        localStorage.setItem("ise_portal_prefs", JSON.stringify(stored));
      } catch { /* ignore */ }
    } else {
      throw err;
    }
  }
  if (lang && TRANSLATIONS[lang]) {
    _locale = lang;
  }
  if (_rerenderFn) _rerenderFn();
}

/**
 * initLocaleFromStorage(portalDefault) — bruges på boot FØR login for at
 * anvende evt. gemt locale fra localStorage (TACACS+-fallback eller tidligere session).
 */
export function initLocaleFromStorage(portalDefault) {
  try {
    const stored = JSON.parse(localStorage.getItem("ise_portal_prefs") || "{}");
    if (stored.language && TRANSLATIONS[stored.language]) {
      _locale = stored.language;
      return;
    }
  } catch { /* ignore */ }
  if (portalDefault && TRANSLATIONS[portalDefault]) {
    _locale = portalDefault;
    return;
  }
  const browserLang = (navigator.language || "").toLowerCase().split("-")[0];
  _locale = TRANSLATIONS[browserLang] ? browserLang : "en";
}
