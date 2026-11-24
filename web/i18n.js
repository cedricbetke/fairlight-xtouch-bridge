// Übersetzungen für die Einstellungsseite.
//
// Deutsch ist die Ausgangssprache: Die Texte stehen unverändert im HTML und in
// app.js. Dieses Modul übersetzt sie zur Laufzeit ins Englische. Der deutsche
// Ausgangstext jedes Knotens wird gemerkt, damit der Wechsel zurück ohne
// Neuladen funktioniert.

const STORAGE_KEY = "ember-bridge.language";
const LANGUAGES = ["de", "en"];

const DOCUMENT_TITLES = {
  de: "Ember Bridge · Einstellungen",
  en: "Ember Bridge · Settings",
};

// Feste Übersetzungen. Der Schlüssel ist exakt der deutsche Text.
export const EN_MESSAGES = {
  // Kopfzeile und Navigation
  "Ember Bridge · Einstellungen": "Ember Bridge · Settings",
  "Einstellungen": "Settings",
  "Bereiche": "Sections",
  "Verbindung": "Connection",
  "Geräte": "Devices",
  "LCD-Anzeige": "LCD display",
  "Sprache": "Language",
  "Fairlight wird geprüft …": "Checking Fairlight …",
  "Kanäle werden geladen": "Loading channels",
  "ON AIR": "ON AIR",
  "OFF AIR": "OFF AIR",
  "Unbekannt": "Unknown",

  // Fairlight-Verbindung
  "Kanäle einlesen": "Load channels",
  "Der Ein-Kanal-Testmodus ist aktiv. Beim Speichern wird auf die Gerätebelegung umgestellt.":
    "Single-channel test mode is active. Saving switches to the device layout.",

  // Geräte
  "Am Griff ziehen oder mit den Pfeilen sortieren. Die Reihenfolge entspricht der Aufstellung von links nach rechts.":
    "Drag the handle or use the arrows to sort. The order matches the physical setup from left to right.",
  "Bank-Vorschau": "Bank preview",
  "Vorherige Bank": "Previous bank",
  "Nächste Bank": "Next bank",
  "Gerät hinzufügen": "Add device",
  "Ports neu einlesen": "Rescan ports",
  "Die Bank-Tasten am Main wechseln beim Betrieb.": "The bank keys on the main unit change banks during operation.",
  "Ziehen oder mit den Pfeiltasten verschieben": "Drag or use the arrow keys to move",
  "Hauptgerät · Bank-Tasten": "Main unit · bank keys",
  "Erweiterung": "Expander",
  "Fest": "Fixed",
  "Bank-Tasten am Gerät": "Bank keys on device",
  "Fader folgen der Bank": "Faders follow the bank",
  "Pegelanzeigen": "Meters",
  "Anschluss": "Connection",
  "Netzwerk": "Network",
  "Eingang": "Input",
  "Ausgang": "Output",
  "IPv4-Adresse": "IPv4 address",
  "RTP-Port": "RTP port",
  "Verbindung testen": "Test connection",
  "Am Gerät: SELECT (CH1) beim Einschalten halten, Drehregler 2 auf NETWORK. Standardport 5004.":
    "On the device: hold SELECT (CH1) while powering on, set encoder 2 to NETWORK. Default port 5004.",
  "Gerät aktiv": "Device enabled",
  "SELECT-LEDs blinken lassen": "Blink SELECT LEDs",
  "Finden": "Find",
  "Blinkt …": "Blinking …",
  "Bearbeiten": "Edit",
  "Gerät bearbeiten": "Edit device",

  // Großes Display am Main
  "Großes Display": "Main display",
  "Anzeige": "Content",
  "Automatisch: Bank und Aux": "Automatic: bank and aux",
  "Sichtbare Kanäle": "Visible channels",
  "Uhrzeit": "Time",
  "On Air (experimentell)": "On air (experimental)",
  "Kanäle von": "Channels from",
  "Gesamte Oberfläche": "Whole surface",
  "Nur Hauptgerät": "Main unit only",
  "Fairlight-Messwert": "Fairlight measurement",
  "Messwert": "Measurement",
  "Integrierte Lautheit": "Integrated loudness",
  "Pegelreserve bis 0 dB": "Headroom to 0 dB",
  "Quelle": "Source",
  "Pegelreserve bis 0 dB aus dem Spitzenpegel des gewählten Busses; ohne Messwert zeigt die Vorschau einen Beispielwert.":
    "Headroom to 0 dB from the peak level of the selected bus; without a reading the preview shows an example value.",
  "Integrierte Lautheit des gewählten Main-Busses. Das Minuszeichen ist am Gerät nicht geprüft; die Vorschau zeigt ohne Messwert einen Beispielwert.":
    "Integrated loudness of the selected main bus. The minus sign is not verified on the device; without a reading the preview shows an example value.",
  "Main Mix": "Main mix",
  "Sends on Fader simulieren": "Simulate sends on fader",
  "On-Air-Zustand simulieren": "Simulate the on-air state",
  "Die Bridge lässt die Anzeige unverändert.": "The bridge leaves the display untouched.",
  "Lokale Uhrzeit des Bridge-Rechners. Beispiel, nicht am Gerät geprüft.":
    "Local time of the bridge host. Example, not verified on the device.",
  "Experimentell: Die Lesbarkeit von Wörtern auf 7 Segmenten ist am Gerät nicht geprüft. Unbekannter Status bleibt leer.":
    "Experimental: word legibility on seven-segment digits is not verified on the device. An unknown state stays blank.",
  "Folgt der Bank-Vorschau. Am Gerät nicht geprüft.":
    "Follows the bank preview. Not verified on the device.",

  "Gerät": "Device",
  "Schließen": "Close",
  "Schließen …": "Closing …",
  "Gerät entfernen": "Remove device",
  "Mindestens ein Gerät bleibt erhalten": "At least one device stays",
  "Mindestens ein Gerät bleibt erhalten.": "At least one device stays.",
  "Gerät entfernt. Die Änderung gilt nach dem Speichern und einem Bridge-Neustart.":
    "Device removed. The change applies after saving and restarting the bridge.",
  "Gerät hinzugefügt · bitte Anschluss wählen": "Device added · choose a connection",
  "Gerät inaktiv · wird beim Banking nicht berücksichtigt": "Device inactive · ignored by banking",
  "Netzwerk · RTP-MIDI · nimmt am Banking teil": "Network · RTP-MIDI · part of banking",
  "Fest · alle acht Fader frei": "Fixed · all eight faders empty",
  "Banking · Kanäle einlesen": "Banking · load channels",
  "Banking · keine Kanäle in dieser Bank": "Banking · no channels in this bank",
  "Netzwerk · Adresse fehlt": "Network · address missing",
  "Netzwerk vorbereitet · IP-Adresse eintragen": "Network prepared · enter an IP address",
  "MIDI-Liste nicht verfügbar": "MIDI list unavailable",
  "Eingang  nicht prüfbar": "Input not checkable",
  "Ausgang  nicht prüfbar": "Output not checkable",
  "Gerät deaktiviert": "Device disabled",
  "Gerät aktivieren, damit die Ports genutzt werden": "Enable the device to use the ports",
  "Kein Ausgang": "No output",
  "Ein- und Ausgang erkannt": "Input and output detected",
  "Ein- und Ausgang fehlen": "Input and output missing",
  "Eingang fehlt": "Input missing",
  "Ausgang fehlt": "Output missing",
  "Lese MIDI-Ports …": "Reading MIDI ports …",
  "Keine MIDI-Ports gefunden": "No MIDI ports found",
  "Bitte zuerst eine IP-Adresse eintragen.": "Enter an IP address first.",
  "Der RTP-Port muss zwischen 1 und 65534 liegen.": "The RTP port must be between 1 and 65534.",
  "Prüfe Verbindung …": "Checking connection …",
  "Verbindung erreichbar": "Connection reachable",
  "Verbindung erreichbar · Simulation": "Connection reachable · simulation",
  "Simulation: RTP-MIDI-Sitzung erreichbar": "Simulation: RTP-MIDI session reachable",
  "Simulation: RTP-MIDI-Sitzung erreichbar · Simulation": "Simulation: RTP-MIDI session reachable · simulation",
  "Gerät finden ist über RTP-MIDI noch nicht verfügbar. Der Verbindungstest prüft die Sitzung.":
    "Finding a device over RTP-MIDI is not available yet. The connection test checks the session.",
  "Unbekanntes Gerät": "Unknown device",
  "Bitte eine IP-Adresse oder einen Hostnamen eintragen": "Enter an IP address or hostname",
  "Die Adresse muss eine IPv4-Adresse oder ein Hostname sein": "The address must be an IPv4 address or hostname",
  "Der RTP-MIDI-Port muss zwischen 1 und 65535 liegen": "The RTP-MIDI port must be between 1 and 65535",
  "Der RTP-MIDI-Port muss zwischen 1 und 65534 liegen": "The RTP-MIDI port must be between 1 and 65534",

  // Feste und freie Ziele
  "Festes Ziel": "Fixed target",
  "Ziel wählen": "Choose target",
  "Frei lassen": "Leave empty",
  "Frei": "Empty",
  "frei": "empty",
  "nicht gewählt": "not selected",
  "Eigener Name": "Custom name",
  "Aktuell": "Current",
  "Verfügbar": "Available",
  "Eingänge und Busse bleiben fest auf diesem Fader. Banking blättert nur durch Eingänge.":
    "Inputs and buses stay fixed on this fader. Banking only pages through inputs.",
  "Kanalzug anklicken, um sein festes Ziel zu wählen. Banking, Mute und Touch-Schutz bleiben Standard.":
    "Click a channel strip to choose its fixed target. Banking, mute and touch protection keep their defaults.",
  "Dieses Gerät folgt dem Banking. Oben am Gerät auf Fest schalten, um Ziele zu wählen.":
    "This device follows banking. Switch it to Fixed above to choose targets.",
  "Tasten belegen und bei Festbelegung die Kanalzüge wählen.":
    "Assign keys and choose channel strips in fixed mode.",
  "Tasten belegen und bei Festbelegung die Kanalzüge wählen.":
    "Assign keys and choose channel strips in fixed mode.",
  "X-Touch Extender · bei Festbelegung die Kanalzüge wählen.":
    "X-Touch Extender · choose channel strips in fixed mode.",
  "Eingänge und Busse zuerst über Fairlight einlesen.": "Load inputs and buses from Fairlight first.",
  "Keine Ziele geladen": "No targets loaded",
  "Kein Treffer": "No match",
  "Andere Suche versuchen.": "Try another search.",
  "Eingang oder Bus suchen …": "Search input or bus …",
  "Fairlight-Kanäle": "Fairlight channels",

  // Funktionstasten
  "Ausgewählte Taste": "Selected key",
  "Funktion": "Function",
  "Nicht belegt": "Unassigned",
  "Aux-Ziel": "Aux target",
  "Diese Taste ist nicht belegt. Am Pult wird sie ignoriert.":
    "This key is unassigned. The console ignores it.",

  // LCD
  "Farben aktiv": "Colors on",
  "Farben aus": "Colors off",
  "LCD-Farben aktiv": "LCD colors on",
  "Obere Zeile": "Top line",
  "Untere Zeile": "Bottom line",
  "Standardfarben": "Default colors",
  "Farbe nach Kanaltyp": "Color by channel type",
  "Ausnahmen und Kurznamen": "Overrides and short names",
  "Kanal oder Bus suchen …": "Search channel or bus …",
  "Automatisch nutzt die Typfarbe. Ein Kurzname ersetzt in der oberen Zeile den Fairlight-Namen. Ausnahmen pausieren, sobald der Fairlight-Name nicht mehr zum gespeicherten Namen passt.":
    "Automatic uses the type color. A short name replaces the Fairlight name on the top line. Overrides pause once the Fairlight name no longer matches the stored name.",
  "Hintergrundfarbe nach Kanaltyp und die beiden Textzeilen der acht Kanalfelder. Farben und Kurznamen folgen dem Kanal beim Banking.":
    "Background color by channel type and the two text lines of the eight channel fields. Colors and short names follow the channel when banking.",
  "Typfarben zurückgesetzt. Ausnahmen bleiben erhalten.": "Type colors reset. Overrides are kept.",
  "Automatisch": "Automatic",
  "Typfarbe": "Type color",
  "Kurzname": "Short name",
  "Aktualisieren": "Update",
  "Name in Fairlight geändert. Ausnahme pausiert bis „Aktualisieren“.":
    "Name changed in Fairlight. Override paused until “Update”.",
  "Nicht in Fairlight gefunden": "Not found in Fairlight",
  "Fairlight-Name": "Fairlight name",
  "Kurzname, sonst Name": "Short name, else name",
  "Typ + Nummer": "Type + number",
  "Nur Typ": "Type only",
  "Nur Nummer": "Number only",
  "Faderwert (dB)": "Fader value (dB)",
  "Aktives Faderziel": "Active fader target",
  "Leer": "Blank",
  "Eingänge": "Inputs",
  "Subgruppen": "Subgroups",
  "Mix-Minus": "Mix minus",
  "Aus": "Off",
  "Rot": "Red",
  "Grün": "Green",
  "Gelb": "Yellow",
  "Blau": "Blue",
  "Weiß": "White",

  // App (Desktop-Installation)
  "Die Bridge läuft, solange die App geöffnet ist. Speichern startet sie mit der neuen Belegung neu.":
    "The bridge runs as long as the app is open. Saving restarts it with the new layout.",
  "Wird vorbereitet …": "Preparing …",
  "Bridge läuft": "Bridge running",
  "Bridge gestoppt": "Bridge stopped",
  "Läuft": "Running",
  "Gestoppt": "Stopped",
  "Verbunden": "Connected",
  "Verbunden · ON AIR": "Connected · ON AIR",
  "Verbunden · OFF AIR": "Connected · OFF AIR",
  "Nicht verbunden": "Not connected",
  "Keine Geräte eingerichtet": "No devices configured",
  "Bridge bei der Anmeldung automatisch starten": "Start the bridge automatically at login",
  "Freigaben für diese Sitzung": "Permissions for this session",
  "Schreibzugriffe auf Fairlight erlauben": "Allow writes to Fairlight",
  "Motoren bewegen (nur mit Schreibzugriff)": "Move motors (requires write access)",
  "Beide Freigaben sind nach jedem App-Start aus. Ziele bleiben zusätzlich durch die Sicherheitslisten der Konfiguration begrenzt.":
    "Both permissions are off after every app start. Targets remain limited by the configuration's safety lists.",
  "Änderungen werden direkt nach dem Speichern übernommen.":
    "Changes apply directly after saving.",
  "Schreibziele in der Konfiguration": "Write targets in the configuration",
  "Kanäle": "Channels",
  "Busse": "Buses",
  "Monitore": "Monitors",
  "z. B. 1, 2, 3": "e.g. 1, 2, 3",
  "z. B. main:1": "e.g. main:1",
  "z. B. 1": "e.g. 1",
  "Kommagetrennt. Leer bedeutet: nichts wird geschrieben. Änderungen werden mit Speichern übernommen.":
    "Comma-separated. Empty means nothing is written. Changes apply when you save.",
  "Gespeichert. Die Bridge läuft mit der neuen Belegung.":
    "Saved. The bridge is running with the new layout.",
  "Wird übernommen …": "Applying …",
  "Übernommen.": "Applied.",
  "Schreibzugriff ist aktiv, aber keine Ziele sind freigegeben. Trage Kanäle, Busse oder Monitore ein und speichere.":
    "Write access is enabled, but no targets are allowed. Enter channels, buses or monitors and save.",

  // Fußleiste
  "Alles gespeichert": "All saved",
  "Ungespeicherte Änderungen": "Unsaved changes",
  "Wird gespeichert …": "Saving …",
  "Speichert …": "Saving …",
  "Speichern": "Save",
  "Verwerfen": "Discard",
  "Änderungen gelten ab dem nächsten Bridge-Start.": "Changes apply at the next bridge start.",
  "Gespeichert. Die neue Belegung gilt beim nächsten Bridge-Start.":
    "Saved. The new layout applies at the next bridge start.",
  "Ungespeicherte Änderungen verwerfen?": "Discard unsaved changes?",
  "Vom Server neu geladen.": "Reloaded from the server.",

  // Zustände und Meldungen
  "Einstellungsseite nicht erreichbar": "Settings page unreachable",
  "Keine Kanäle": "No channels",
  "Keine Kanäle geladen": "No channels loaded",
  "Fairlight nicht erreichbar": "Fairlight unreachable",
  "Bitte einen Host eintragen.": "Enter a host.",
  "Der Port muss zwischen 1 und 65535 liegen.": "The port must be between 1 and 65535.",
  "Verbinde mit Fairlight …": "Connecting to Fairlight …",
  "Kein Banking": "No banking",
  "Dieses Gerät ist deaktiviert.": "This device is disabled.",
  "Für dieses Gerät ist kein MIDI-Ausgang ausgewählt.": "No MIDI output is selected for this device.",

  // Hardware-Draufsichten
  "X-Touch Extender Draufsicht": "X-Touch Extender top view",
  "X-Touch Draufsicht": "X-Touch top view",
};

// Muster für Texte mit eingesetzten Werten. Reihenfolge: speziell vor allgemein.
const EN_RULES = [
  [/^Anfrage fehlgeschlagen \((\d+)\)$/, "Request failed ($1)"],
  [/^(\d+) von (\d+) online$/, "$1 of $2 online"],
  [/^Kanäle: „(.+)“ ist keine gültige Nummer\.$/, "Channels: “$1” is not a valid number."],
  [/^Busse: „(.+)“ muss die Form main:1 haben\.$/, "Buses: “$1” must use the form main:1."],
  [/^Monitore: „(.+)“ ist keine gültige Nummer\.$/, "Monitors: “$1” is not a valid number."],
  [/^Farben aktiv · 1 Ausnahme$/, "Colors on · 1 override"],
  [/^Farben aktiv · (\d+) Ausnahmen$/, "Colors on · $1 overrides"],
  [/^Aktiv · (.+)$/, "Active · $1"],
  [/^Bank (\d+) \/ (\d+)$/, "Bank $1 / $2"],
  [/^(.+) nach links verschieben$/, "Move $1 left"],
  [/^(.+) nach rechts verschieben$/, "Move $1 right"],
  [/^(.+) verschieben$/, "Move $1"],
  [/^(.+) umbenennen$/, "Rename $1"],
  [/^(.+) entfernen$/, "Remove $1"],
  [/^(.+) belegen$/, "Assign $1"],
  [/^(.+) · Simulation$/, "$1 · simulation"],
  [/^(.+) · Hauptgerät · Bank-Tasten$/, "$1 · Main unit · bank keys"],
  [/^(.+) · Erweiterung$/, "$1 · Expander"],
  [/^Eigener Name für (.+)$/, "Custom name for $1"],
  [/^Kanalmodus für (.+)$/, "Channel mode for $1"],
  [/^Anschluss für (.+)$/, "Connection for $1"],
  [/^Farbe für (.+)$/, "Color for $1"],
  [/^LCD-Kurzname für (.+)$/, "LCD short name for $1"],
  [/^LCD-Farbe für (.+)$/, "LCD color for $1"],
  [/^Fader (\d+): (.+) wählen$/, "Select fader $1: $2"],
  [/^(.+) belegen$/, "Assign $1"],
  [/^Kanal (\d+)$/, "Channel $1"],
  [/^Ziel für (.+) · Fader (\d+)$/, "Target for $1 · fader $2"],
  [/^Fest · (\d+) von 8 Fadern belegt · (\d+) Busse$/, "Fixed · $1 of 8 faders assigned · $2 buses"],
  [/^Fest · (\d+) von 8 Fadern belegt · (\d+) Bus$/, "Fixed · $1 of 8 faders assigned · $2 bus"],
  [/^Fest · (\d+) von 8 Fadern belegt$/, "Fixed · $1 of 8 faders assigned"],
  [/^Fest · (.+) F(\d+)$/, "Fixed · $1 F$2"],
  [/^Banking · Kanäle (\d+)–(\d+)$/, "Banking · channels $1–$2"],
  [/^Banking · (\d+) Kanäle in dieser Bank$/, "Banking · $1 channels in this bank"],
  [/^Netzwerk · Simulation für (.+):(\d+)$/, "Network · simulation for $1:$2"],
  [/^Netzwerk gespeichert · RTP-MIDI \((.+):(\d+)\)$/, "Network saved · RTP-MIDI ($1:$2)"],
  [
    /^RTP-MIDI-Sitzung mit (.+):(\d+) angenommen$/,
    "RTP-MIDI session with $1:$2 accepted",
  ],
  [
    /^RTP-MIDI-Sitzung mit (.+):(\d+) nicht möglich: (.+)\. Läuft die Bridge bereits für dieses Gerät\?$/,
    "RTP-MIDI session with $1:$2 failed: $3. Is the bridge already running for this device?",
  ],
  [/^Netzwerk · (.+):(\d+)$/, "Network · $1:$2"],
  [/^Eingang\s+(.+) · nicht gefunden$/, "Input $1 · not found"],
  [/^Ausgang\s+(.+) · nicht gefunden$/, "Output $1 · not found"],
  [/^Eingang\s+(.+) · erkannt$/, "Input $1 · detected"],
  [/^Ausgang\s+(.+) · erkannt$/, "Output $1 · detected"],
  [/^MIDI-Ausgang „(.+)“ wurde nicht gefunden\.$/, "MIDI output “$1” was not found."],
  [/^(.*) · nicht gefunden$/, "$1 · not found"],
  [/^(.*) · nicht erkannt$/, "$1 · not detected"],
  [/^(\d+) Eingänge, (\d+) Ausgänge gelesen$/, "$1 inputs, $2 outputs scanned"],
  [/^Ports nicht verfügbar: (.+)$/, "Ports unavailable: $1"],
  [/^Gerät hinzugefügt · Port (.+)$/, "Device added · port $1"],
  [/^Demo · (\d+) Eingänge · (\d+) Busse$/, "Demo · $1 inputs · $2 buses"],
  [/^(\d+) Eingänge · (\d+) Busse erkannt$/, "$1 inputs · $2 buses detected"],
  [/^(\d+) Eingänge · (\d+) Busse · aktuell frei$/, "$1 inputs · $2 buses · currently empty"],
  [/^(\d+) Eingänge · (\d+) Busse · aktuell (.+)$/, "$1 inputs · $2 buses · currently $3"],
  [/^(\d+) Eingänge · (\d+) Busse$/, "$1 inputs · $2 buses"],
  [/^(\d+) Eingänge, (\d+) Busse und (\d+) Monitore erkannt\.$/, "$1 inputs, $2 buses and $3 monitors detected."],
  [/^(\d+) Eingänge$/, "$1 inputs"],
  [/^Busse · (\d+)$/, "Buses · $1"],
  [/^Eingänge · (\d+)$/, "Inputs · $1"],
  [/^Aux (\d+) \(nicht erkannt\)$/, "Aux $1 (not detected)"],
  [/^Monitor (\d+) \(nicht erkannt\)$/, "Monitor $1 (not detected)"],
  [/^(.+?) ruft (.+) als Aux-Mix auf\. PAN schaltet zurück\.$/, "$1 brings up $2 as the aux mix. PAN returns."],
  [
    /^Aux (\d+) wurde nicht erkannt\. Die Belegung bleibt erhalten, die Taste bleibt wirkungslos\.$/,
    "Aux $1 was not detected. The assignment is kept, but the key has no effect.",
  ],
  [
    /^Monitor (\d+) wurde nicht erkannt\. Die Belegung bleibt erhalten, die Taste bleibt wirkungslos\.$/,
    "Monitor $1 was not detected. The assignment is kept, but the key has no effect.",
  ],
  [
    /^(.+?) schaltet Monitor (\d+) \((.+)\) auf Dim, sofern der Monitor in der Schreibfreigabe steht\. Die LED folgt Fairlight\.$/,
    "$1 dims monitor $2 ($3) if the monitor is write-enabled. The LED follows Fairlight.",
  ],
  [
    /^(.+?) schaltet Monitor (\d+) \((.+)\) auf Dim\. Die LED leuchtet nur bei bestätigtem Dim-Zustand\.$/,
    "$1 dims monitor $2 ($3). The LED lights only when Fairlight confirms dim.",
  ],
  [
    /^Im Betrieb: Bankbereich; bei aktivem Sends on Fader Aux (\d+)\. Ohne Fairlight bleibt sie leer\.$/,
    "During operation: bank range; with sends on fader active, aux $1. It stays blank without Fairlight.",
  ],
];

// Absätze mit Auszeichnung im Text. Vollständiges HTML je Sprache, damit
// <strong> und andere Inline-Elemente erhalten bleiben.
export const HTML_BLOCKS = {
  "connection.help": {
    de: "Ember+ in Fairlight unter <strong>File → Show Settings → Ember+</strong> aktivieren und den angezeigten Port übernehmen.",
    en: "Enable Ember+ in Fairlight under <strong>File → Show Settings → Ember+</strong> and use the port shown there.",
  },
  "devices.footnote": {
    de: "<strong>Bearbeiten</strong> öffnet die große Ansicht des Geräts. <strong>Finden</strong> lässt die SELECT-LEDs blinken. <strong>Fest</strong> hält die acht Ziele. <strong>Banking</strong> folgt der gemeinsamen Bank-Vorschau.",
    en: "<strong>Edit</strong> opens the large view of the device. <strong>Find</strong> blinks the SELECT LEDs. <strong>Fixed</strong> holds the eight targets. <strong>Banking</strong> follows the shared bank preview.",
  },
};

const HTML_ATTRIBUTES = ["title", "placeholder", "aria-label", "aria-description", "alt"];

let language = "de";
let initialized = false;
let applying = false;

const textState = new WeakMap();
const attributeState = new WeakMap();
const htmlState = new WeakMap();

function translateString(value, lang) {
  if (lang === "de") return value;
  const exact = EN_MESSAGES[value];
  if (typeof exact === "string") return exact;
  for (const [pattern, replacement] of EN_RULES) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

export function translate(value, lang = language) {
  return translateString(value, lang === "en" ? "en" : "de");
}

function translateTextNode(node) {
  const data = node.data;
  if (typeof data !== "string" || data.trim() === "") return;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(data);
  if (!match) return;
  const [, leading, core, trailing] = match;
  const previous = textState.get(node);
  const source = previous && core === previous.translated ? previous.source : core;
  const translated = translateString(source, language);
  textState.set(node, { source, translated });
  const next = `${leading}${translated}${trailing}`;
  if (next !== data) node.data = next;
}

function translateAttributes(element) {
  let entries = attributeState.get(element);
  for (const name of HTML_ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name);
    if (current === null || current.trim() === "") continue;
    if (!entries) {
      entries = new Map();
      attributeState.set(element, entries);
    }
    const previous = entries.get(name);
    const source = previous && current === previous.translated ? previous.source : current;
    const translated = translateString(source, language);
    entries.set(name, { source, translated });
    if (translated !== current) element.setAttribute(name, translated);
  }
}

function applyHtmlBlock(element) {
  const key = element.getAttribute("data-i18n-html");
  const block = key ? HTML_BLOCKS[key] : null;
  if (!block) return;
  const html = block[language] ?? block.de;
  if (htmlState.get(element) === html) return;
  htmlState.set(element, html);
  element.innerHTML = html;
}

function translateTree(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    translateTextNode(node);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node;
  const tag = element.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
  if (element.hasAttribute("data-i18n-html")) {
    applyHtmlBlock(element);
    return;
  }
  if (element.getAttribute("translate") === "no") return;
  translateAttributes(element);
  for (const child of element.childNodes) translateTree(child);
}

function applyLanguageToDocument() {
  if (typeof document === "undefined") return;
  applying = true;
  try {
    document.documentElement.lang = language;
    document.title = DOCUMENT_TITLES[language];
    if (document.body) translateTree(document.body);
  } finally {
    applying = false;
  }
}

export function getLanguage() {
  return language;
}

export function detectLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {
    // Ohne Speicher entscheidet die Browsersprache.
  }
  const preferred = typeof navigator === "undefined" ? "" : String(navigator.language ?? "").toLowerCase();
  return preferred.startsWith("de") ? "de" : "en";
}

export function setLanguage(next) {
  if (!LANGUAGES.includes(next) || next === language) return language;
  language = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Die Auswahl gilt dann nur für diese Sitzung.
  }
  applyLanguageToDocument();
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("languagechange", { detail: { language } }));
  }
  return language;
}

export function initI18n() {
  if (initialized || typeof document === "undefined") return language;
  initialized = true;
  language = detectLanguage();
  applyLanguageToDocument();
  if (document.body) {
    const observer = new MutationObserver(() => {
      if (applying) return;
      translateTree(document.body);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: HTML_ATTRIBUTES,
    });
  }
  return language;
}
