# PDF Splitter → Paperless-ngx — Spezifikation

## Ziel
Lokale Webapp (localhost), die Bulk-Scans (viele Dokumente in einem PDF) automatisch in Einzeldokumente
trennt, je Dokument Lieferant/Datum/Titel erkennt, eine Korrektur-Ansicht bietet und die Ergebnisse
direkt per API in Paperless-ngx hochlädt.

**Erfolg:** Ein Ordner-Scan ist nach wenigen Minuten Kontrolle korrekt getrennt und mit richtigem
Korrespondenten in Paperless.

## Ablauf
1. **Upload** – PDF per Drag & Drop in die Webapp.
2. **Rendern** – Jede Seite wird zu einem Bild gerendert (Vorschau + Eingabe für das Modell).
   Falls das PDF schon eine Textebene hat (Scanner-OCR), wird der Text zusätzlich mitgegeben.
3. **Analyse je Seite** (Vision-LLM) → JSON:
   `{ "is_first_page": bool, "confidence": 0-1, "supplier": str|null, "date": "YYYY-MM-DD"|null,
     "title": str|null, "page_marker": "Seite 2 von 3"|null, "is_blank": bool }`
   Die Ergebnisse der Vorseite gehen als Kontext in den Prompt ein (Seitenzähler, Lieferant).
4. **Trennvorschlag** – Neues Dokument, wenn `is_first_page` oder ein anderer Lieferant erkannt wird.
   Leere Seiten (Duplex-Rückseiten) werden zum Entfernen markiert.
5. **Korrektur-Ansicht**
   - Seitenübersicht mit Vorschaubildern, Dokumente farblich gruppiert
   - Klick zwischen zwei Seiten = Trennstelle setzen/entfernen
   - Seite löschen, Seite um 90°/180° drehen
   - Je Dokument: Korrespondent (Dropdown mit Paperless-Korrespondenten + ähnliche Namen vorgeschlagen
     + „neu anlegen“), Titel, Datum
   - Unsichere Trennstellen (niedrige confidence) werden hervorgehoben
6. **Upload nach Paperless** – je Dokument `POST /api/documents/post_document/` mit
   `document`, `title`, `correspondent`, `created`. Status über `/api/tasks/?task_id=…` verfolgen
   (inkl. „Duplikat“-Meldung von Paperless).
   **Fallback:** PDFs in den Consume-Ordner der NAS schreiben (ohne Metadaten).

## Lieferanten-Abgleich
- `GET /api/correspondents/` (alle Seiten) beim Start und vor dem Upload laden.
- Ähnlichkeitsvergleich mit `rapidfuzz` (z. B. „Telekom“ ≈ „Telekom Deutschland GmbH“);
  Rechtsformen (GmbH, AG, KG, e.V., …) werden vor dem Vergleich entfernt.
- Status je Dokument: ✅ exakt vorhanden · 🟡 ähnlicher Name gefunden (vorgeschlagen) · ➕ neu.
- „Neu anlegen“ → `POST /api/correspondents/` (nur auf Klick, nie automatisch).

## Technik
| Bereich   | Wahl |
|-----------|------|
| Backend   | Python 3.13, FastAPI, uvicorn |
| PDF       | PyMuPDF (Rendern, Trennen, Drehen, Textebene) |
| LLM       | `openai`-Client gegen OpenAI-kompatiblen Endpoint → Ollama (`qwen2.5vl:7b`), OpenRouter **oder** OpenAI |
| Matching  | rapidfuzz |
| Paperless | httpx, Token-Auth |
| Frontend  | Eine HTML-Seite + Vanilla JS, ausgeliefert von FastAPI (kein Build-Schritt) |
| Speicher  | `data/jobs/<id>/` mit Original-PDF, Seitenbildern und `state.json` → Jobs sind fortsetzbar |

Kein Tesseract nötig – das Vision-Modell liest die Seiten direkt.

## Konfiguration (`.env`, nicht eingecheckt)
```
PAPERLESS_URL=https://paperless.schroederhub.de
PAPERLESS_TOKEN=...
# optional, falls Cloudflare Access vor Paperless hängt:
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=
LLM_BASE_URL=http://localhost:11434/v1     # oder https://api.openai.com/v1
LLM_API_KEY=ollama                          # bei OpenAI der echte Key
LLM_MODEL=qwen2.5vl:7b
CONSUME_DIR=\\NAS\paperless\consume         # Fallback
```

## Nicht im Umfang
Hosting außerhalb localhost · Benutzerverwaltung · Scanner-Ansteuerung · Dokumenttyp-/Tag-Erkennung
(macht Paperless-Auto-Matching) · Seiten umsortieren zwischen Dokumenten.

## Umsetzung in Schritten
1. Gerüst: FastAPI, Config, Upload, Seiten rendern, Vorschau-Grid anzeigen
2. Manuelles Trennen/Löschen/Drehen in der UI + Export als Einzel-PDFs
3. Paperless-Anbindung: Korrespondenten laden, Fuzzy-Match, Upload + Task-Status
4. LLM-Analyse: Trennvorschläge + Lieferant/Datum/Titel
5. Feinschliff: Unsicherheiten hervorheben, Consume-Fallback, Job fortsetzen

Nach Schritt 2 ist das Tool schon ohne KI nutzbar (manuelles Trennen + Upload).
