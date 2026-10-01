# PDF Splitter → Paperless-ngx

Lokale Webapp für Bulk-Scans. Du scannst einen ganzen Stapel Dokumente in **ein** PDF. Die App trennt es in
einzelne Dokumente, erkennt je Dokument **Absender, Datum und Titel**, gleicht den Absender mit deinen
**Paperless-Korrespondenten** ab und lädt alles direkt nach Paperless hoch. Du prüfst nur noch die gelb
markierten Stellen.

Läuft nur auf `localhost`. Es gibt keine Benutzerverwaltung und kein Hosting.

---

## Funktionen

| | |
|---|---|
| **Automatische Trennung** | Eine Vision-KI liest jede Seite und erkennt Briefköpfe, Seitenangaben („Seite 2 von 3“) und Absenderwechsel. Läuft lokal mit Ollama oder über OpenRouter oder OpenAI. |
| **Duplex-Modus** | Leere Rückseiten werden erkannt und ausgeblendet. Neue Dokumente beginnen nur auf Vorderseiten. |
| **Korrektur-Ansicht** | ✂ zwischen zwei Seiten trennt, „Zusammenführen“ an der Kartengrenze verbindet. Seiten lassen sich drehen und entfernen. |
| **Unsichere Stellen** | Wo die KI unsicher war, ist die Stelle orange markiert. Mit „✓ Trennung passt“ bestätigst du sie. |
| **Lieferanten-Abgleich** | ✓ *vorhanden* · ≈ *ähnlicher Name* (z. B. „Telekom“ ↔ „Telekom Deutschland GmbH“) · ＋ *neu*. Neue Korrespondenten legst du direkt im Suchfeld an. Alle Dokumente mit demselben Absender bekommen ihn dann automatisch zugeordnet. |
| **Status je Dokument** | *Bereit*, *Prüfen* (der Tooltip nennt den Grund), *In Paperless*, *Duplikat* oder *Fehler*. |
| **Upload** | Über die Paperless-API mit Korrespondent, Titel und Datum. Paperless meldet den Verarbeitungsstatus und erkennt Duplikate. |
| **Fallback** | Kopie in den Consume-Ordner der NAS, ohne Metadaten. |
| **Fortsetzbar** | Scans und Korrekturen werden gespeichert. Du kannst später weitermachen. |

Jedes Bedienelement hat einen **Tooltip**. Fahr mit der Maus darüber, dann steht dort, was es macht.

---

## Installation (Windows)

**Voraussetzungen:** Python 3.11 oder neuer, Git, eine laufende Paperless-ngx-Instanz.

```powershell
git clone https://github.com/tomjschr/pdfsplitter.git
cd pdfsplitter
.\start.ps1
```

Der erste Start legt die Python-Umgebung (`.venv`) an, installiert die Pakete und erzeugt eine `.env` aus
[.env.example](.env.example). Trage dort deine Werte ein und starte `.\start.ps1` erneut. Danach öffnet sich
**http://localhost:8765**.

> Falls PowerShell das Skript blockiert: `powershell -ExecutionPolicy Bypass -File .\start.ps1`

### Konfiguration (`.env`)

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `PAPERLESS_URL` | ✔ | z. B. `https://paperless.schroederhub.de` oder im Heimnetz `http://<nas-ip>:8000` (schneller) |
| `PAPERLESS_TOKEN` | ✔ | Paperless → Profil (oben rechts) → **API-Token** |
| `LLM_BASE_URL` | – | OpenAI-kompatibler Endpoint. Leer = ohne KI, du trennst dann selbst. |
| `LLM_MODEL` | – | Entscheidet über Trennung und Metadaten, z. B. `qwen3-vl:8b` |
| `LLM_API_KEY` | – | Bei Ollama beliebig, bei OpenRouter/OpenAI dein Key |
| `OCR_MODEL` | – | Schaltet den **zweistufigen Modus** ein, z. B. `glm-ocr`. Leer = einstufig |
| `OCR_BASE_URL` / `OCR_API_KEY` | – | Nur falls das OCR-Modell woanders läuft als `LLM_BASE_URL` |
| `CONSUME_DIR` | – | Fallback, z. B. `\\NAS\paperless\consume` |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | – | Nur nötig, wenn **Cloudflare Access** vor Paperless hängt (Zero Trust → Service Auth → Service Token) |

Die `.env` wird nie eingecheckt.

### Paperless-Token holen

1. Paperless im Browser öffnen → oben rechts auf deinen Namen → **Mein Profil**
2. Unter **API-Token** auf ↻ (erzeugen) klicken und den Token kopieren
3. In der `.env` eintragen: `PAPERLESS_TOKEN=dein-token`

### KI einrichten

Die App spricht jede **OpenAI-kompatible** Schnittstelle an. Du wählst eine Variante und trägst ein paar Zeilen
in die `.env` ein. In [.env.example](.env.example) stehen alle Varianten schon vorbereitet. Lass dort genau einen
Block aktiv und kommentiere die anderen mit `#` aus.

#### Einstufig oder zweistufig?

| | Einstufig | **Zweistufig (empfohlen)** |
|---|---|---|
| Ablauf | Ein Vision-Modell sieht das Seitenbild und entscheidet direkt | **1.** GLM-OCR liest den Text aller Seiten → **2.** ein Sprachmodell entscheidet mit dem Text der **vorherigen, aktuellen und nächsten Seite** |
| Stärke | einfacher, ein Modell | erkennt fortlaufende Briefe, Überträge, „Seite 2 von 3“ und Anlagen deutlich zuverlässiger |
| Einschalten | `OCR_MODEL=` leer | `OCR_MODEL=glm-ocr` |

Im zweistufigen Modus liest die App zuerst alle Seiten und analysiert danach. Es liegt also immer nur ein Modell
im Grafikspeicher. Den erkannten Text jeder Seite siehst du in der Großansicht unter **„Erkannter Text“**. Dort
kannst du nachsehen, wenn eine Trennung danebenliegt.

| | Ollama (lokal) | OpenRouter | OpenAI |
|---|---|---|---|
| Kosten | kostenlos | ca. 0,50–2 € pro 1.000 Seiten | ca. 1–3 € pro 1.000 Seiten |
| Datenschutz | nichts verlässt deinen PC | Seiten gehen an den Modell-Anbieter | Seiten gehen an OpenAI |
| Geschwindigkeit | ca. 3–10 s/Seite (GPU) | ca. 1–3 s/Seite | ca. 1–3 s/Seite |
| Genauigkeit | gut | sehr gut | sehr gut |

#### Variante A: Ollama (lokal, empfohlen bei sensiblen Dokumenten)

Eine RTX 4070 mit 12 GB reicht. Insgesamt brauchst du ca. 8,5 GB Speicherplatz für die Modelle.

**Was du installierst:**

| Was | Wozu | Größe |
|---|---|---|
| [Ollama](https://ollama.com/download) **ab 0.12.7** | führt die Modelle lokal aus | – |
| `glm-ocr` | Stufe 1: liest den Text jeder Seite (laut Anbieter Platz 1 auf OmniDocBench V1.5) | 2,2 GB |
| `qwen3-vl:8b` | Stufe 2: entscheidet über Trennung, Absender, Datum, Titel | 6,1 GB |

**Schritte:**

1. Ollama installieren: https://ollama.com/download. Es läuft danach im Hintergrund (Symbol im Infobereich).
   Ist Ollama schon installiert, prüf die Version mit `ollama --version`. Unter 0.12.7 einfach den aktuellen Installer drüber installieren.
2. Beide Modelle laden (einmalig):
   ```powershell
   ollama pull glm-ocr
   ollama pull qwen3-vl:8b
   ```
3. Prüfen, ob Ollama läuft und beide Modelle da sind:
   ```powershell
   ollama list
   ```
4. Optional einen Schnelltest mit einem gescannten Bild machen:
   ```powershell
   ollama run glm-ocr "Text Recognition: C:\Pfad\zu\scan.png"
   ```
5. `.env`:
   ```ini
   LLM_BASE_URL=http://localhost:11434/v1
   LLM_API_KEY=ollama
   LLM_MODEL=qwen3-vl:8b
   OCR_MODEL=glm-ocr
   ```
6. Die App neu starten. Oben rechts sollte jetzt **„KI · glm-ocr + qwen3-vl:8b“** stehen.
7. Während einer Analyse kannst du mit `ollama ps` prüfen, ob die GPU genutzt wird. In der Spalte *PROCESSOR* sollte `100% GPU` stehen.

**Alternativen:**
- **Einstufig:** `OCR_MODEL=` leer lassen. Dann sieht `qwen3-vl:8b` direkt das Seitenbild. Das braucht nur ein Modell, ist aber etwas ungenauer bei mehrseitigen Dokumenten.
- **Speziell für deutsche Geschäftsdokumente:** [`Keyvan/german-ocr-3.1`](https://ollama.com/Keyvan/german-ocr-3.1). Ein Community-Modell (ca. 3 GB) auf Qwen-3.5-Basis. Zum Ausprobieren als `LLM_MODEL` im einstufigen Modus; unabhängige Tests dazu habe ich nicht gefunden.
- **Stärker, aber knapp für 12 GB:** `gemma3:12b` als `LLM_MODEL`.

#### Variante B: OpenRouter (ein Key für viele Modelle)

1. Konto anlegen auf https://openrouter.ai und unter **Credits** etwas Guthaben aufladen (5 $ reichen für viele Ordner)
2. Unter **Settings → Keys** (https://openrouter.ai/settings/keys) auf **Create Key** klicken. Optional ein Kreditlimit setzen, z. B. 5 $.
3. Den Key kopieren. Er beginnt mit `sk-or-v1-` und wird nur einmal angezeigt.
4. `.env`:
   ```ini
   LLM_BASE_URL=https://openrouter.ai/api/v1
   LLM_API_KEY=sk-or-v1-...
   LLM_MODEL=google/gemini-2.5-flash-lite
   ```
5. **Datenschutz:** Unter **Settings → Privacy** Anbieter ausschließen, die Eingaben fürs Training nutzen. Wenn möglich *Zero Data Retention* aktivieren.

**Kombination (lokal + OpenRouter):** Den Text erkennt GLM-OCR lokal per Ollama, die Entscheidung trifft ein
OpenRouter-Modell. Dann geht nur der erkannte Text raus, keine Bilder. Ergänze dafür zum OpenRouter-Block:

```ini
OCR_MODEL=glm-ocr
OCR_BASE_URL=http://localhost:11434/v1
OCR_API_KEY=ollama
```

Im zweistufigen Modus braucht das Entscheidungsmodell keine Bild-Eingabe. Dann gehen auch reine Textmodelle.

Passende Modelle (mit Bild-Eingabe, Stand Oktober 2026):

| `LLM_MODEL` | Eignung |
|---|---|
| `google/gemini-2.5-flash-lite` | sehr günstig, gute Texterkennung – **guter Start** |
| `qwen/qwen3-vl-32b-instruct` | günstig, stark bei Dokumenten |
| `google/gemini-2.5-flash` | genauer, etwas teurer – wenn die Trennung oft daneben liegt |
| `openai/gpt-4.1-mini` | solide Alternative |

Alle Modelle findest du unter https://openrouter.ai/models (Filter: *Input Modalities → Image*). Den Namen
kopierst du 1:1 in `LLM_MODEL`. Unterstützt ein Modell den JSON-Modus nicht, schaltet die App ihn automatisch ab.

Was wie viel gekostet hat, siehst du unter https://openrouter.ai/activity.

#### Variante C: OpenAI direkt

1. Key erstellen unter https://platform.openai.com/api-keys und Guthaben unter *Billing* aufladen
2. `.env`:
   ```ini
   LLM_BASE_URL=https://api.openai.com/v1
   LLM_API_KEY=sk-...
   LLM_MODEL=gpt-4.1-mini
   ```

#### Variante D: Ohne KI

`LLM_BASE_URL=` leer lassen. Leere Seiten werden trotzdem erkannt, die Trennstellen setzt du selbst mit ✂.

#### Läuft alles?

Nach dem Neustart zeigt die App oben rechts zwei Punkte: **Paperless** und **KI**. Grün heißt verbunden. Fährst
du mit der Maus darüber, siehst du Details, z. B. wie viele Korrespondenten geladen wurden oder welches Modell
genutzt wird. Ob die KI wirklich antwortet, zeigt erst ein Test-Scan. Schlägt die Analyse fehl, erscheint ein
gelber Hinweis mit der Fehlermeldung.

---

## Bedienung

1. **Scan hinzufügen:** PDF in die Ablage oder irgendwo ins Fenster ziehen. Den Schalter *Duplex-Scan* passend setzen.
2. **Kurz warten:** Die KI analysiert Seite für Seite, die Trennvorschläge erscheinen schon währenddessen.
3. **Gelbe Dokumente prüfen:**
   - Falsche Trennung → ✂ zwischen zwei Seiten klicken oder *Zusammenführen*
   - Trennung stimmt → **✓ Trennung passt**
   - Korrespondent fehlt → im Suchfeld auswählen oder „… neu anlegen“
   - Titel und Datum bei Bedarf anpassen
4. **Hochladen:** Unten rechts auf **„N Dokumente hochladen“** klicken, oder einzeln über das Upload-Symbol am Dokument.

Mit dem 📄-Symbol am Dokument siehst du vorab genau das PDF, das hochgeladen wird.

### Großansicht & Tastenkürzel

Ein Klick auf eine Seite öffnet sie groß. Rechts daneben steht, was die KI erkannt hat.

| Taste | Aktion |
|---|---|
| `←` / `→` | Vorherige / nächste Seite |
| `S` | Ab dieser Seite neues Dokument (oder Trennung aufheben) |
| `Enter` | Unsichere Trennstelle bestätigen |
| `R` | Seite drehen |
| `Entf` | Seite entfernen / wiederherstellen |
| `Esc` | Schließen |

Im Korrespondenten-Feld: Tippen filtert die Liste, `↑` / `↓` wählt, `Enter` übernimmt, `Esc` bricht ab.

### Tipps

- **Dokumenttypen und Tags** vergibt die App nicht. Lege dafür in Paperless Regeln mit Auto-Matching an, die greifen nach dem Upload.
  Mehr Automatik bekommst du mit [paperless-gpt](https://github.com/icereed/paperless-gpt). Es läuft per Docker z. B. auf der NAS und vergibt
  per Ollama Tags, Dokumenttypen und eigene Felder. Es ergänzt diese App gut: Die App trennt, paperless-gpt verschlagwortet.
- **Beim Scannen** Heftklammern entfernen und Seiten gerade einlegen. Gedrehte Seiten kannst du aber auch in der App drehen.
- **Klein anfangen:** Der erste Ordner mit 20–30 Seiten zeigt, wie gut die Trennung bei deinen Dokumenten klappt.

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| „Weiterleitung nach … – vermutlich Cloudflare Access“ | Service-Token in `CF_ACCESS_CLIENT_ID/SECRET` eintragen oder die lokale NAS-Adresse nutzen |
| Paperless antwortet 401/403 | `PAPERLESS_TOKEN` prüfen |
| „OCR-Modell nicht erreichbar“ | `ollama list` zeigt `glm-ocr` nicht → `ollama pull glm-ocr`. Ist die Ollama-Version zu alt, aktualisieren |
| „model requires a newer version of Ollama“ | Aktuellen Installer von ollama.com drüber installieren (`qwen3-vl` braucht mindestens 0.12.7) |
| Trennung trotz zweistufig falsch | In der Großansicht „Erkannter Text“ öffnen. Ist der Text schon Unsinn, liegt es am Scan (Auflösung, Schräglage). Ist der Text gut, ein stärkeres `LLM_MODEL` probieren |
| „KI nicht erreichbar“ (Ollama) | Läuft Ollama (Symbol im Infobereich)? Mit `ollama list` prüfen, ob das Modell geladen ist |
| `401` / „No auth credentials“ (OpenRouter/OpenAI) | `LLM_API_KEY` prüfen, ohne Leerzeichen oder Anführungszeichen |
| `402` / „Insufficient credits“ | Guthaben bei OpenRouter/OpenAI aufladen |
| „model not found“ / „No endpoints found“ | `LLM_MODEL` exakt wie auf openrouter.ai/models schreiben und darauf achten, dass das Modell Bilder unterstützt |
| Status „Duplikat“ | Paperless kennt das Dokument schon. Mit dem Papierkorb-Symbol entfernen oder ignorieren. |
| Analyse sehr langsam | Ein kleineres Modell nehmen oder OpenAI nutzen. Lokal sind ca. 3–10 s pro Seite normal. |
| Leere Seite wird nicht erkannt | Seite in der Vorschau entfernen. Für stark verschmutzte Scans lassen sich die Schwellwerte in `app/pdf.py` anpassen. |

---

## Entwicklung

```powershell
.\.venv\Scripts\python.exe -m pytest                                      # Tests
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8765   # Dev-Server
```

```
app/
├── main.py        REST-API (FastAPI) + Auslieferung des Frontends
├── jobs.py        Scan-Zustand, Analyse-Ablauf, Export & Upload
├── splitting.py   Trennlogik (Vorschläge, Duplex, Unsicherheit)
├── llm.py         Prompt und Aufruf des Vision-Modells
├── matching.py    Unscharfer Namensabgleich mit Korrespondenten
├── paperless.py   Paperless-ngx API-Client
├── pdf.py         Rendern, Leerseiten-Erkennung, Teil-PDFs bauen
├── config.py      Einstellungen aus .env
└── static/        Frontend (HTML/CSS/JS, kein Build-Schritt)
tests/             pytest
```

Daten liegen unter `data/jobs/<id>/` (Original-PDF, Vorschaubilder, `state.json`) und werden nicht eingecheckt.
Die Anforderungen stehen in [SPEC.md](SPEC.md).
