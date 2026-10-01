# Startet den PDF Splitter auf http://localhost:8765
# Beim ersten Start wird die Python-Umgebung angelegt.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .venv)) {
    Write-Host "Lege Python-Umgebung an ..."
    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host ".env angelegt - bitte PAPERLESS_TOKEN eintragen und neu starten." -ForegroundColor Yellow
}

Start-Process "http://localhost:8765"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
