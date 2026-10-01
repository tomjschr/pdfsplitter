# PDF Splitter → Paperless-ngx

Lokale Webapp für Bulk-Scans: Du scannst einen ganzen Stapel Dokumente in **ein** PDF, die App trennt es
automatisch in Einzeldokumente, erkennt je Dokument **Lieferant/Absender, Datum und Titel**, gleicht den
Lieferanten mit deinen **Paperless-Korrespondenten** ab und lädt alles direkt nach Paperless hoch.
Du korrigierst nur noch, was die KI falsch gemacht hat.

## Funktionen
- **Automatische Trennung** per Vision-KI (lokal mit Ollama oder über OpenAI)
- **Duplex-Modus:** leere Rückseiten werden erkannt und entfernt; neue Dokumente beginnen nur auf Vorderseiten
- **Korrektur-Ansicht:** ✂ zwischen zwei Seiten = neues Dokument, ⤒ = zusammenführen, Seiten drehen/entfernen,
  große Ansicht mit Pfeiltasten; unsichere Stellen sind orange markiert
- **Lieferanten-Abgleich** mit Paperless: ✓ vorhanden · ≈ ähnlicher Name (z. B. „Telekom“ ↔ „Telekom Deutschland GmbH“) · neu
  → neue Korrespondenten per Klick anlegen
- **Upload** per Paperless-API inkl. Korrespondent, Titel und Datum; Status- und Duplikat-Erkennung
- **Fallback:** Kopie in den Consume-Ordner der NAS
- Jobs werden gespeichert und können später fortgesetzt werden

## Installation (Windows)
Voraussetzung: Python 3.11+

```powershell
git clone https://github.com/tomjschr/pdfsplitter.git
cd pdfsplitter
.\start.ps1
```

Beim ersten Start wird die Python-Umgebung angelegt und eine `.env` aus `.env.example` erzeugt.
Dort mindestens eintragen:

| Variable | Bedeutung |
|---|---|
| `PAPERLESS_URL` | z. B. `https://paperless.schroederhub.de` oder lokal `http://<nas-ip>:8000` |
| `PAPERLESS_TOKEN` | Paperless → Profil → API-Token |
| `LLM_BASE_URL` / `LLM_MODEL` | KI-Endpoint (siehe unten); leer = ohne KI, nur manuelles Trennen |
| `CONSUME_DIR` | optional, z. B. `\\NAS\paperless\consume` |
| `CF_ACCESS_CLIENT_ID` / `_SECRET` | nur falls Cloudflare Access vor Paperless hängt |

Danach läuft die App auf **http://localhost:8765**.

### KI lokal mit Ollama (empfohlen, z. B. RTX 4070 12 GB)
1. Ollama installieren: https://ollama.com/download
2. Modell laden: `ollama pull qwen2.5vl:7b`
3. In `.env`: `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=qwen2.5vl:7b`

Alternativen: `gemma3:12b` (passt knapp in 12 GB) oder OpenAI (`LLM_BASE_URL=https://api.openai.com/v1`,
`LLM_API_KEY=sk-…`, `LLM_MODEL=gpt-4.1-mini`). Dann verlassen die Seitenbilder allerdings dein Netzwerk.

## Bedienung
1. PDF links in die Ablage ziehen (Duplex-Haken passend setzen)
2. Warten, bis die Analyse durch ist; die Vorschläge erscheinen schon währenddessen
3. Je Dokument prüfen: Trennung, Korrespondent, Titel, Datum
4. „Alle … nach Paperless“ oder einzeln „Hochladen“

Tipp: Lege in Paperless Dokumenttypen und Tags mit Auto-Matching an. Das übernimmt Paperless nach dem Upload selbst.

## Entwicklung
```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8765
```

Aufbau: `app/main.py` (API) · `app/jobs.py` (Jobzustand, Upload) · `app/splitting.py` (Trennlogik) ·
`app/llm.py` (Prompt, KI-Aufruf) · `app/matching.py` (Namensabgleich) · `app/paperless.py` (API-Client) ·
`app/pdf.py` (Rendern, Leerseiten, Export) · `app/static/` (Frontend, ohne Build-Schritt).
Details: [SPEC.md](SPEC.md)
