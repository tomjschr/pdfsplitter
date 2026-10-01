"use strict";

// ===== Helfer ===============================================================
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "");

// Icons (Pfade nach Lucide, ISC-Lizenz)
const ICONS = {
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/>',
  merge: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  "rotate-cw": '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
function hydrateIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => { if (!el.querySelector("svg")) el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon)); });
}

// ===== API ==================================================================
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* kein JSON */ }
    throw new Error(msg);
  }
  return res.json();
}
const put = (path, body) => api(path, { method: "PUT", body: JSON.stringify(body) });
const post = (path, body) => api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

// ===== Toasts, Dialog, Tooltip ==============================================
function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "bad" ? "alert" : "check")}<span>${esc(msg)}</span>`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "bad" ? 6000 : 3000);
}
const fail = (e) => toast(e.message || String(e), "bad");

function ask({ title, text = "", buttons }) {
  const dlg = $("#dialog");
  $("form", dlg).innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="buttons">${buttons
    .map((b) => `<button type="button" class="btn ${b.primary ? "primary" : b.danger ? "danger" : ""}" value="${esc(b.value)}">${esc(b.label)}</button>`).join("")}</div>`;
  return new Promise((resolve) => {
    const done = (value) => { dlg.oncancel = null; if (dlg.open) dlg.close(); resolve(value || null); };
    $$(".buttons .btn", dlg).forEach((b) => { b.onclick = () => done(b.value); });
    dlg.oncancel = (e) => { e.preventDefault(); done(null); }; // Esc
    dlg.showModal();
    $(".btn.primary", dlg)?.focus();
  });
}

// Tooltips: erscheinen schnell (Doherty-Schwelle), auch per Tastaturfokus
const tip = $("#tooltip");
let tipTimer = null;
let tipTarget = null;
function showTip(el) {
  const text = el.dataset.tip;
  if (!text) return;
  tip.innerHTML = esc(text).replace(/\[(.+?)\]/g, "<kbd>$1</kbd>");
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let top = r.top - t.height - 8;
  if (top < 8) top = r.bottom + 8;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}
function hideTip() { clearTimeout(tipTimer); tip.hidden = true; tipTarget = null; }
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  if (el === tipTarget) return;
  hideTip();
  if (!el) return;
  tipTarget = el;
  tipTimer = setTimeout(() => showTip(el), 250);
});
document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el && e.target.matches(":focus-visible")) showTip(el); });
document.addEventListener("focusout", hideTip);
document.addEventListener("scroll", hideTip, true);
document.addEventListener("mousedown", hideTip);

// ===== Zustand ==============================================================
const state = { config: null, jobs: [], job: null, jobId: null, correspondents: [], pollTimer: null, lastJson: "" };

async function init() {
  hydrateIcons();
  state.config = await api("/api/config");
  await loadCorrespondents();
  renderPills();
  await loadJobs();
  const fromHash = location.hash.slice(1);
  if (fromHash && state.jobs.some((j) => j.id === fromHash)) openJob(fromHash);
  else renderEmpty();
}

async function loadCorrespondents(refresh = false) {
  state.corrError = null;
  if (!state.config.paperless_configured) return;
  try { state.correspondents = await api(`/api/correspondents${refresh ? "?refresh=true" : ""}`); }
  catch (e) { state.corrError = e.message; }
}

function renderPills() {
  const c = state.config;
  const paperlessTip = !c.paperless_configured
    ? "Paperless ist nicht eingerichtet. Trage PAPERLESS_URL und PAPERLESS_TOKEN in die .env ein und starte neu."
    : state.corrError ? `Paperless nicht erreichbar: ${state.corrError}`
    : `Verbunden mit ${c.paperless_url} · ${state.correspondents.length} Korrespondenten geladen`;
  const paperlessOn = c.paperless_configured && !state.corrError;
  const llmTip = c.llm_configured
    ? (c.ocr_model
      ? `Zweistufig: ${c.ocr_model} liest den Text jeder Seite, ${c.llm_model} entscheidet anhand der Nachbarseiten über die Trennung`
      : `Die Seiten werden mit ${c.llm_model} analysiert`)
      + ` – ${c.llm_local ? "lokal auf deinem Rechner, nichts verlässt dein Netzwerk." : "über einen Cloud-Dienst."}`
    : "Keine KI eingerichtet – Trennstellen setzt du dann selbst. LLM_BASE_URL in der .env setzen.";
  const consumeTip = c.consume_configured ? "Fallback aktiv: Dokumente können auch in den Consume-Ordner kopiert werden." : "Kein Consume-Ordner eingerichtet (optional, CONSUME_DIR in der .env).";
  $("#status-pills").innerHTML =
    `<span class="pill ${paperlessOn ? "on" : "off"}" data-tip="${esc(paperlessTip)}"><span class="dot"></span>Paperless</span>` +
    `<span class="pill ${c.llm_configured ? "on" : "off"}" data-tip="${esc(llmTip)}"><span class="dot"></span>KI${c.llm_configured ? ` · ${c.ocr_model ? `${esc(c.ocr_model)} + ` : ""}${esc(c.llm_model)}` : " aus"}</span>` +
    (c.consume_configured ? `<span class="pill on" data-tip="${esc(consumeTip)}"><span class="dot"></span>Consume</span>` : "");
}

// ===== Upload ===============================================================
function bindDropzone(dz) {
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); uploadFiles(e.dataTransfer.files); });
  $("input[type=file]", dz)?.addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });
}
bindDropzone($("#dropzone"));
// Dateien überall auf der Seite ablegen können
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { if (!e.target.closest(".dropzone")) { e.preventDefault(); uploadFiles(e.dataTransfer.files); } });

async function uploadFiles(files) {
  const pdfs = [...files].filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) return toast("Bitte PDF-Dateien ablegen", "bad");
  let lastId = null;
  for (const [n, f] of pdfs.entries()) {
    $("#upload-progress").textContent = `Lade ${pdfs.length > 1 ? `${n + 1}/${pdfs.length}: ` : ""}${f.name} …`;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("duplex", $("#duplex").checked);
    try { lastId = (await api("/api/jobs", { method: "POST", body: fd })).id; } catch (e) { fail(new Error(`${f.name}: ${e.message}`)); }
  }
  $("#upload-progress").textContent = "";
  await loadJobs();
  if (lastId) openJob(lastId);
}

// ===== Jobliste =============================================================
async function loadJobs() {
  state.jobs = await api("/api/jobs");
  $("#job-list").innerHTML = state.jobs.map((j) => {
    const busy = j.status !== "ready";
    const pct = busy ? (100 * j.progress.done) / Math.max(1, j.progress.total) : (100 * j.uploaded) / Math.max(1, j.documents);
    const meta = busy
      ? `<span class="spinner"></span> Analysiere ${j.progress.done}/${j.progress.total}`
      : j.uploaded && j.uploaded >= j.documents ? `${icon("check")} alle ${j.documents} hochgeladen`
      : `${j.progress.total} S. · ${j.uploaded}/${plural(j.documents, "Dokument", "Dokumente")} hochgeladen`;
    return `<li class="job ${j.id === state.jobId ? "active" : ""} ${busy ? "busy" : ""}" data-id="${j.id}" data-tip="${esc(`${j.filename} · angelegt am ${fmtDate(j.created_at)}`)}">
      <div class="name">${esc(j.filename)}</div>
      <div class="meta">${meta}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
    </li>`;
  }).join("") || `<li class="job-empty">Noch keine Scans</li>`;
}
$("#job-list").addEventListener("click", (e) => { const li = e.target.closest("[data-id]"); if (li) openJob(li.dataset.id); });

async function openJob(id) {
  state.jobId = id;
  state.lastJson = "";
  history.replaceState(null, "", `#${id}`);
  await refresh(true);
  loadJobs();
  window.scrollTo(0, 0);
}

async function refresh(force = false) {
  clearTimeout(state.pollTimer);
  if (!state.jobId) return;
  let json;
  try {
    const res = await fetch(`/api/jobs/${state.jobId}`);
    if (!res.ok) throw new Error("Scan nicht gefunden");
    json = await res.text();
  } catch (e) {
    state.jobId = null; state.job = null;
    history.replaceState(null, "", location.pathname);
    renderEmpty();
    return fail(e);
  }
  const changed = json !== state.lastJson;
  state.lastJson = json;
  state.job = JSON.parse(json);
  // Nicht neu zeichnen, während getippt wird oder sich nichts geändert hat
  const active = document.activeElement;
  const editing = active && $("#main").contains(active) && active.matches("input, select, textarea");
  if (force || (changed && !editing)) renderJob();
  if (!$("#viewer").hidden) renderViewer();
  if (needsPolling(state.job)) state.pollTimer = setTimeout(() => { refresh(); loadJobs(); }, 1500);
}

const needsPolling = (job) => job.status !== "ready" || job.documents.some((d) => d.upload && ["uploading", "queued"].includes(d.upload.status));

// ===== Leerer Zustand =======================================================
function renderEmpty() {
  $("#main").innerHTML = `
    <div class="empty">
      <h1>Bulk-Scans in Paperless bringen</h1>
      <p>Scanne einen ganzen Stapel in ein PDF. Die App trennt ihn in einzelne Dokumente, erkennt Absender, Datum und Titel – du prüfst nur noch kurz und lädst hoch.</p>
      <label class="dropzone big">
        <input type="file" accept="application/pdf" multiple hidden>
        <span class="dz-icon">${icon("upload")}</span>
        <span class="dz-text"><strong>PDF hierher ziehen</strong><span>oder klicken, um Dateien auszuwählen</span></span>
      </label>
      <div class="steps">
        <div class="step"><div class="n">1</div><b>Hochladen</b>Bulk-Scan als PDF ablegen – Duplex wird unterstützt.</div>
        <div class="step"><div class="n">2</div><b>Prüfen</b>Gelb markierte Stellen ansehen, bei Bedarf trennen oder zusammenführen.</div>
        <div class="step"><div class="n">3</div><b>Ablegen</b>Mit einem Klick alles mit Korrespondent, Titel und Datum nach Paperless.</div>
      </div>
    </div>`;
  bindDropzone($("#main .dropzone"));
}

// ===== Dokument-Status ======================================================
function corrName(id) { return state.correspondents.find((c) => c.id === id)?.name ?? null; }

function reviewReasons(d) {
  const r = [];
  if (d.uncertain_pages?.length) {
    r.push(`Die KI war unsicher, ob bei Seite ${d.uncertain_pages.map((i) => i + 1).join(", ")} ein neues Dokument beginnt`);
  }
  if (state.config.paperless_configured && d.correspondent_id == null) {
    r.push(d.supplier ? `„${d.supplier}“ gibt es noch nicht in Paperless` : "Kein Korrespondent erkannt");
  } else if (d.match?.status === "similar" && !d.correspondent_edited) {
    r.push(`Ähnlicher Name zugeordnet – erkannt wurde „${d.supplier}“`);
  }
  if (!d.date) r.push("Kein Datum erkannt");
  return r;
}

function docState(d, job) {
  const up = d.upload;
  if (!d.active_pages.length) return { key: "empty", label: "Keine Seiten", cls: "", tip: "Alle Seiten dieses Dokuments sind entfernt – es wird nicht hochgeladen." };
  if (up && !d.changed_since_upload) {
    if (up.status === "success") return { key: "done", label: "In Paperless", cls: "ok", icon: "check", tip: up.message || "Erfolgreich hochgeladen" };
    if (up.status === "uploading") return { key: "busy", label: "Lädt hoch …", cls: "accent", spin: true, tip: "Das PDF wird übertragen" };
    if (up.status === "queued") return { key: "busy", label: "Paperless verarbeitet …", cls: "accent", spin: true, tip: up.message || "Paperless liest das Dokument ein (OCR)" };
    if (up.status === "duplicate") return { key: "error", label: "Duplikat", cls: "bad", icon: "copy", tip: `Paperless hat das Dokument als bereits vorhanden abgelehnt. ${up.message || ""}` };
    if (up.status === "failure") return { key: "error", label: "Fehler", cls: "bad", icon: "alert", tip: up.message || "Upload fehlgeschlagen" };
  }
  if (job.status !== "ready" && !d.supplier) return { key: "busy", label: "Wird analysiert", cls: "", spin: true, tip: "Die KI liest die Seiten noch" };
  const reasons = reviewReasons(d);
  if (reasons.length) return { key: "review", label: "Prüfen", cls: "warn", icon: "alert", tip: reasons.join(" · ") };
  return { key: "ready", label: "Bereit", cls: "info", icon: "check", tip: "Alles erkannt – kann hochgeladen werden" };
}

const isPending = (d) => d.active_pages.length && (!d.upload || ["failure"].includes(d.upload.status) || d.changed_since_upload);

// ===== Jobansicht ===========================================================
function renderJob() {
  const job = state.job;
  const busy = job.status !== "ready";
  const docs = job.documents;
  const states = docs.map((d) => docState(d, job));
  const real = docs.filter((d) => d.active_pages.length);
  const done = states.filter((s) => s.key === "done").length;
  const review = states.filter((s) => s.key === "review").length;
  const pending = docs.filter(isPending);
  const blanks = job.pages.filter((p) => p.blank).length;
  const restoreSuggestion = job.splits_edited && job.suggested_splits.length && JSON.stringify(job.splits) !== JSON.stringify(job.suggested_splits);
  const allDone = !busy && real.length && done === real.length;
  const scrollY = window.scrollY;

  $("#main").innerHTML = `
    <div class="job-head">
      <div>
        <h1>${esc(job.filename)}</h1>
        <div class="sub">${plural(job.pages.length, "Seite", "Seiten")} · ${job.duplex ? `Duplex · ${plural(blanks, "leere Seite", "leere Seiten")} ausgeblendet` : "Simplex"} · ${fmtDate(job.created_at)}</div>
      </div>
      <div class="actions">
        ${restoreSuggestion ? `<button class="btn ghost" data-act="use-suggestions" data-tip="Verwirft deine manuell gesetzten Trennstellen und stellt den Vorschlag der KI wieder her.">${icon("undo")}KI-Vorschlag</button>` : ""}
        <button class="icon-btn ghost" data-act="analyze" ${busy || !state.config.llm_configured ? "disabled" : ""} data-tip="${state.config.llm_configured ? "Seiten erneut von der KI analysieren lassen" : "Keine KI eingerichtet"}">${icon("sparkles")}</button>
        <button class="icon-btn ghost" data-act="delete-job" data-tip="Scan aus dieser Liste löschen. Bereits hochgeladene Dokumente bleiben in Paperless.">${icon("trash")}</button>
      </div>
    </div>
    ${busy ? `<div class="banner info"><span class="spinner"></span><div class="grow">
        <b>${job.progress.phase === "ocr" ? `Schritt 1/2 · Texterkennung Seite ${job.progress.done} von ${job.progress.total}`
          : `${state.config.ocr_model ? "Schritt 2/2 · " : ""}KI analysiert Seite ${job.progress.done} von ${job.progress.total}`}</b>
        – ${job.progress.phase === "ocr" ? "danach schlägt die KI die Trennstellen vor." : "du kannst schon währenddessen prüfen und korrigieren."}
        <div class="progress"><span style="width:${(100 * job.progress.done) / Math.max(1, job.progress.total)}%"></span></div></div></div>` : ""}
    ${job.message ? `<div class="banner warn">${icon("alert")}<div class="grow">${esc(job.message)}</div></div>` : ""}
    ${job.paperless_error ? `<div class="banner bad">${icon("alert")}<div class="grow"><b>Paperless nicht erreichbar.</b> ${esc(job.paperless_error)}</div></div>` : ""}
    ${allDone ? `<div class="banner success">${icon("check")}<div class="grow"><div class="big">Fertig – ${plural(done, "Dokument ist", "Dokumente sind")} in Paperless.</div>
        Paperless liest sie jetzt ein und vergibt Tags & Dokumenttypen.</div>
        ${state.config.paperless_url ? `<a class="btn" href="${esc(state.config.paperless_url)}/documents" target="_blank">${icon("external")}Paperless öffnen</a>` : ""}
        <button class="btn" data-act="delete-job">${icon("trash")}Scan entfernen</button></div>` : ""}
    ${docs.map((d, n) => renderDoc(job, d, n, states[n])).join("")}
    ${renderActionBar({ real, done, review, pending, busy })}
  `;
  window.scrollTo(0, scrollY);
}

function renderActionBar({ real, done, review, pending, busy }) {
  if (!real.length) return "";
  const ready = pending.length - review;
  const c = state.config;
  const disabled = busy || !pending.length;
  const why = busy ? "Warte, bis die Analyse fertig ist" : !pending.length ? "Alles ist bereits hochgeladen" : "";
  return `
    <div class="actionbar">
      <div class="stats">
        <span data-tip="Dokumente, die schon in Paperless sind"><span class="legend-dot" style="background:var(--ok)"></span><b>${done}</b> hochgeladen</span>
        ${review ? `<span data-tip="Gelb markierte Dokumente: Trennstelle unsicher, Korrespondent fehlt/neu oder kein Datum"><span class="legend-dot" style="background:var(--warn)"></span><b>${review}</b> prüfen</span>` : ""}
        <span data-tip="Vollständig erkannte Dokumente"><span class="legend-dot" style="background:var(--info)"></span><b>${Math.max(0, ready)}</b> bereit</span>
      </div>
      <div class="goal" data-tip="${done} von ${real.length} Dokumenten erledigt">
        <div class="track"><span style="width:${(100 * done) / real.length}%"></span></div>
        <small>${done} von ${real.length} erledigt</small>
      </div>
      ${c.consume_configured ? `<button class="btn" data-act="consume-all" ${disabled ? "disabled" : ""} data-tip="${esc(why || "Kopiert die PDFs ohne Metadaten in den Consume-Ordner der NAS (Fallback)")}">${icon("folder")}Consume</button>` : ""}
      ${c.paperless_configured ? `<button class="btn primary lg" data-act="upload-all" ${disabled ? "disabled" : ""} data-tip="${esc(why || "Lädt alle offenen Dokumente mit Korrespondent, Titel und Datum nach Paperless")}">${icon("upload")}${pending.length ? `${plural(pending.length, "Dokument", "Dokumente")} hochladen` : "Alles hochgeladen"}</button>` : ""}
    </div>`;
}

function renderDoc(job, d, n, st) {
  const name = d.correspondent_id != null ? corrName(d.correspondent_id) : null;
  const titleLine = name || d.supplier || null;
  const canUpload = job.status === "ready" && d.active_pages.length && st.key !== "busy";
  const pagesHtml = d.pages.map((i, k) => {
    const page = job.pages[i];
    // Trennzonen nur vor sichtbaren Seiten – ausgeblendete Seiten erzeugen kein Rauschen
    const gap = k > 0 && !page.deleted ? renderGap(page, i) : "";
    return gap + (page.deleted ? renderStub(page, i) : renderPage(job, page, i));
  }).join("");

  return `
    <section class="doc state-${st.key}" data-start="${d.start}">
      ${d.start > 0 ? `<button class="join" data-act="merge" data-page="${d.start}" data-tip="Diese Trennung aufheben: Dokument ${n + 1} wird an Dokument ${n} angehängt.">${icon("merge")}Zusammenführen</button>` : ""}
      <div class="doc-top">
        <span class="doc-num">${n + 1}</span>
        <span class="doc-name">${titleLine ? esc(titleLine) : `<span class="none">Unbekannter Absender</span>`}</span>
        <span class="count">${plural(d.active_pages.length, "Seite", "Seiten")}</span>
        <span class="spacer"></span>
        ${d.uncertain_pages?.length ? `<button class="btn sm" data-act="confirm" data-tip="Bestätigt, dass die Trennung dieses Dokuments so stimmt (Seite ${d.uncertain_pages.map((i) => i + 1).join(", ")}). Die gelbe Markierung verschwindet.">${icon("check")}Trennung passt</button>` : ""}
        <span class="chip ${st.cls}" data-tip="${esc(st.tip)}">${st.spin ? `<span class="spinner"></span>` : st.icon ? icon(st.icon) : ""}${esc(st.label)}</span>
        <div class="tools">
          ${st.key === "done" && d.upload.document_id && state.config.paperless_url ? `<a class="icon-btn ghost" href="${esc(state.config.paperless_url)}/documents/${d.upload.document_id}/details" target="_blank" data-tip="In Paperless öffnen">${icon("external")}</a>` : ""}
          <a class="icon-btn ghost" href="/api/jobs/${job.id}/documents/${d.start}.pdf" target="_blank" data-tip="So wird das PDF hochgeladen – Vorschau in neuem Tab">${icon("file")}</a>
          ${state.config.consume_configured ? `<button class="icon-btn ghost" data-act="consume" ${canUpload ? "" : "disabled"} data-tip="Nur dieses Dokument in den Consume-Ordner kopieren (ohne Metadaten)">${icon("folder")}</button>` : ""}
          ${state.config.paperless_configured ? `<button class="icon-btn ${st.key === "done" ? "ghost" : "primary"}" data-act="upload" ${canUpload ? "" : "disabled"} data-tip="${st.key === "done" ? "Erneut nach Paperless hochladen" : "Nur dieses Dokument nach Paperless hochladen"}">${icon("upload")}</button>` : ""}
        </div>
      </div>
      <div class="fields">
        ${renderCombo(d)}
        <label class="field f-title"><span>Titel</span>
          <input class="input" data-field="title" value="${esc(d.title)}" placeholder="z. B. Rechnung März 2024" data-tip="Titel in Paperless. Leer lassen = Paperless nimmt den Dateinamen.">
        </label>
        <label class="field"><span>Datum</span>
          <input class="input" type="date" data-field="date" value="${esc(d.date)}" data-tip="Ausstellungsdatum des Dokuments (in Paperless „Erstellt am“)">
        </label>
      </div>
      <div class="doc-body"><div class="pages">${pagesHtml}</div></div>
    </section>`;
}

function renderGap(page, i) {
  const unsure = isUnsure(page);
  const tipText = unsure
    ? `Die KI ist unsicher, ob hier ein neues Dokument beginnt. Klicken = ab Seite ${i + 1} trennen. Gehört die Seite dazu, oben „Trennung passt“ klicken.`
    : `Klicken = ab Seite ${i + 1} ein neues Dokument beginnen`;
  return `<div class="gap ${unsure ? "uncertain" : ""}" data-act="split" data-page="${i}" data-tip="${esc(tipText)}"><span class="knob">${icon("scissors")}</span></div>`;
}

const isUnsure = (page) => !page.blank && !page.deleted && !page.confirmed && page.analysis && page.analysis.confidence < 0.7;

function renderStub(page, i) {
  const why = page.blank ? "leer" : "entfernt";
  return `<div class="stub" data-act="toggle-delete" data-page="${i}" data-tip="Seite ${i + 1} ist ${page.blank ? "leer und wurde automatisch ausgeblendet" : "entfernt"}. Klicken zum Wiederherstellen."><span>S.${i + 1} ${why}</span></div>`;
}

function renderPage(job, page, i) {
  const side = job.duplex ? (i % 2 ? " · Rückseite" : "") : "";
  return `
    <div class="page" data-page="${i}">
      <div class="thumb" data-act="view" data-page="${i}" data-tip="${esc(pageTip(page, i))}">
        <img loading="lazy" class="r${page.rotation}" style="transform:rotate(${page.rotation}deg)" src="/api/jobs/${job.id}/pages/${i}.jpg" alt="Seite ${i + 1}">
        ${page.error ? `<span class="flag chip bad">${icon("alert")}</span>` : ""}
        <div class="overlay">
          <button class="icon-btn" data-act="rotate-ccw" data-page="${i}" data-tip="Nach links drehen">${icon("rotate-ccw")}</button>
          <button class="icon-btn" data-act="rotate" data-page="${i}" data-tip="Nach rechts drehen [R]">${icon("rotate-cw")}</button>
          <button class="icon-btn del" data-act="toggle-delete" data-page="${i}" data-tip="Seite entfernen – sie wird nicht mit hochgeladen [Entf]">${icon("trash")}</button>
        </div>
      </div>
      <div class="label">Seite ${i + 1}${side}</div>
    </div>`;
}

function pageTip(page, i) {
  const a = page.analysis;
  if (page.error) return `Analyse fehlgeschlagen: ${page.error}`;
  if (!a) return `Seite ${i + 1} – klicken für große Ansicht`;
  const parts = [a.supplier && `Absender: ${a.supplier}`, a.title, a.page_marker, `KI-Sicherheit ${Math.round(a.confidence * 100)} %`].filter(Boolean);
  return `${parts.join(" · ")} – klicken für große Ansicht`;
}

// ===== Korrespondent-Combobox (Hick's Law: Vorschläge statt langer Liste) =====
function renderCombo(d) {
  if (!state.config.paperless_configured) {
    return `<div class="field"><span>Absender (erkannt)</span><input class="input" value="${esc(d.supplier || "")}" disabled data-tip="Paperless ist nicht eingerichtet – der Abgleich mit Korrespondenten ist deaktiviert."></div>`;
  }
  const m = d.match;
  let chip = "";
  if (d.correspondent_id != null && !d.correspondent_edited && m?.status === "exact") chip = `<span class="chip ok" data-tip="Dieser Korrespondent existiert bereits in Paperless">${icon("check")}vorhanden</span>`;
  else if (d.correspondent_id != null && !d.correspondent_edited && m?.status === "similar") chip = `<span class="chip warn" data-tip="${esc(`Erkannt wurde „${d.supplier}“ – automatisch dem ähnlichsten vorhandenen Korrespondenten zugeordnet (${m.best.score} % Übereinstimmung). Bitte kurz prüfen.`)}">≈ ${m.best.score} %</span>`;
  else if (d.correspondent_id == null && d.supplier) chip = `<span class="chip info" data-tip="${esc(`„${d.supplier}“ gibt es noch nicht in Paperless. Im Feld auswählen oder neu anlegen.`)}">${icon("plus")}neu</span>`;
  const value = d.correspondent_id != null ? corrName(d.correspondent_id) ?? `#${d.correspondent_id}` : "";
  return `
    <div class="field"><span>Korrespondent ${chip}</span>
      <div class="combo" data-start="${d.start}">
        <input class="input combo-input" value="${esc(value)}" placeholder="${esc(d.supplier ? `„${d.supplier}“ anlegen oder suchen …` : "Suchen oder neu anlegen …")}" autocomplete="off"
          data-tip="Tippen zum Suchen. Vorschläge stehen oben. Gibt es den Absender noch nicht, kannst du ihn direkt anlegen.">
        <span class="caret">${icon("chevron-down")}</span>
      </div>
    </div>`;
}

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
let combo = null; // { el, start, items, index }

function comboItems(d, query) {
  const q = norm(query);
  const items = [];
  const sugg = d.match?.suggestions || [];
  if (!q) {
    if (d.supplier && d.match?.status !== "exact") items.push({ type: "create", name: d.supplier, label: `„${d.supplier}“ neu anlegen` });
    if (sugg.length) {
      items.push({ type: "group", label: "Vorschläge" });
      sugg.forEach((s) => items.push({ type: "opt", id: s.id, label: s.name, score: s.score }));
    }
    items.push({ type: "opt", id: null, label: "Kein Korrespondent", muted: true });
    const sIds = new Set(sugg.map((s) => s.id));
    const rest = state.correspondents.filter((c) => !sIds.has(c.id));
    if (rest.length) {
      items.push({ type: "group", label: `Alle (${state.correspondents.length})` });
      rest.slice(0, 60).forEach((c) => items.push({ type: "opt", id: c.id, label: c.name }));
    }
    return items;
  }
  const hits = state.correspondents
    .map((c) => ({ c, n: norm(c.name) }))
    .filter(({ n }) => q.split(" ").every((w) => n.includes(w)))
    .sort((a, b) => (a.n.startsWith(q) ? 0 : 1) - (b.n.startsWith(q) ? 0 : 1) || a.n.length - b.n.length)
    .slice(0, 40);
  hits.forEach(({ c }) => items.push({ type: "opt", id: c.id, label: c.name }));
  if (!state.correspondents.some((c) => norm(c.name) === q)) items.push({ type: "create", name: query.trim(), label: `„${query.trim()}“ neu anlegen` });
  return items;
}

function openCombo(input) {
  const wrap = input.closest(".combo");
  const start = Number(wrap.dataset.start);
  const d = state.job.documents.find((x) => x.start === start);
  combo = { input, wrap, start, d, items: [], index: -1, chosen: false };
  input.select();
  updateCombo("");
}

function updateCombo(query) {
  if (!combo) return;
  combo.items = comboItems(combo.d, query);
  const selectable = combo.items.map((it, i) => (it.type === "group" ? -1 : i)).filter((i) => i >= 0);
  combo.index = selectable.length ? (query ? selectable[0] : selectable.find((i) => combo.items[i].type === "opt" && combo.items[i].id === combo.d.correspondent_id) ?? selectable[0]) : -1;
  let list = $(".combo-list", combo.wrap);
  if (!list) { list = document.createElement("div"); list.className = "combo-list"; combo.wrap.append(list); }
  list.innerHTML = combo.items.map((it, i) => it.type === "group"
    ? `<div class="combo-group">${esc(it.label)}</div>`
    : `<div class="combo-opt ${it.type === "create" ? "create" : ""} ${it.muted ? "muted" : ""} ${i === combo.index ? "active" : ""}" data-i="${i}">
         ${it.type === "create" ? icon("plus") : it.id === combo.d.correspondent_id && it.id != null ? icon("check") : icon(it.id == null ? "x" : "user")}
         <span>${esc(it.label)}</span>${it.score ? `<span class="score">${it.score} %</span>` : ""}</div>`).join("")
    || `<div class="combo-empty">Keine Treffer</div>`;
  $(".combo-opt.active", list)?.scrollIntoView({ block: "nearest" });
}

function closeCombo() {
  if (!combo) return;
  $(".combo-list", combo.wrap)?.remove();
  if (!combo.chosen) combo.input.value = combo.d.correspondent_id != null ? corrName(combo.d.correspondent_id) ?? "" : "";
  combo = null;
}

async function chooseCombo(i) {
  const it = combo?.items[i];
  if (!it || it.type === "group") return;
  const { start, input } = combo;
  combo.chosen = true;
  input.value = it.type === "create" ? it.name : it.id == null ? "" : it.label;
  closeCombo();
  input.blur();
  try {
    let id = it.id ?? null;
    if (it.type === "create") {
      const created = await post("/api/correspondents", { name: it.name });
      await loadCorrespondents(true);
      id = created.id;
      toast(`Korrespondent „${created.name}“ in Paperless angelegt`);
    }
    await put(`/api/jobs/${state.job.id}/documents/${start}`, { correspondent_id: id });
  } catch (e) { fail(e); }
  await refresh(true);
}

$("#main").addEventListener("focusin", (e) => { if (e.target.matches(".combo-input")) openCombo(e.target); });
$("#main").addEventListener("input", (e) => { if (e.target.matches(".combo-input")) updateCombo(e.target.value); });
$("#main").addEventListener("focusout", (e) => { if (e.target.matches(".combo-input")) setTimeout(() => { if (combo && combo.input === e.target) closeCombo(); }, 120); });
$("#main").addEventListener("mousedown", (e) => {
  const opt = e.target.closest(".combo-opt");
  if (opt) { e.preventDefault(); chooseCombo(Number(opt.dataset.i)); return; }
  // Feld war schon fokussiert (kein focusin) → Liste trotzdem öffnen
  if (e.target.matches(".combo-input") && document.activeElement === e.target && combo?.input !== e.target) openCombo(e.target);
});
$("#main").addEventListener("keydown", (e) => {
  if (e.target.matches(".combo-input") && combo?.input !== e.target && ["ArrowDown", "Enter"].includes(e.key)) {
    e.preventDefault();
    return openCombo(e.target);
  }
  if (!combo || e.target !== combo.input) return;
  const sel = combo.items.map((it, i) => (it.type === "group" ? -1 : i)).filter((i) => i >= 0);
  const pos = sel.indexOf(combo.index);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    combo.index = sel[Math.min(sel.length - 1, Math.max(0, pos + (e.key === "ArrowDown" ? 1 : -1)))];
    $$(".combo-opt", combo.wrap).forEach((o) => o.classList.toggle("active", Number(o.dataset.i) === combo.index));
    $(".combo-opt.active", combo.wrap)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    chooseCombo(combo.index);
  } else if (e.key === "Escape") {
    combo.input.blur();
  }
});

// ===== Aktionen =============================================================
async function setLayout(body) { await put(`/api/jobs/${state.job.id}/layout`, body); }
function pagesWith(fn) { const pages = state.job.pages.map((p) => ({ deleted: p.deleted, rotation: p.rotation })); fn(pages); return pages; }
const rotatePage = (i, delta) => setLayout({ pages: pagesWith((p) => { p[i].rotation = (p[i].rotation + delta + 360) % 360; }) });
const toggleDelete = (i) => setLayout({ pages: pagesWith((p) => { p[i].deleted = !p[i].deleted; }) });
const toggleSplit = (i) => setLayout({ splits: state.job.splits.includes(i) ? state.job.splits.filter((s) => s !== i) : [...state.job.splits, i] });

async function uploadMany(target) {
  const job = state.job;
  const docs = job.documents.filter(isPending);
  const review = docs.filter((d) => docState(d, job).key === "review").length;
  const noCorr = target === "paperless" ? docs.filter((d) => d.correspondent_id == null).length : 0;
  const lines = [];
  if (review) lines.push(`${plural(review, "Dokument ist", "Dokumente sind")} noch gelb markiert.`);
  if (noCorr) lines.push(`${plural(noCorr, "Dokument hat", "Dokumente haben")} keinen Korrespondenten.`);
  const res = await ask({
    title: `${plural(docs.length, "Dokument", "Dokumente")} ${target === "paperless" ? "nach Paperless hochladen" : "in den Consume-Ordner kopieren"}?`,
    text: lines.join("\n") || "Alle Dokumente sind vollständig erkannt.",
    buttons: [{ label: "Abbrechen", value: "" }, { label: "Hochladen", value: "go", primary: true }],
  });
  if (res !== "go") return;
  for (const d of docs) await post(`/api/jobs/${job.id}/documents/${d.start}/upload?target=${target}`);
  toast(`${plural(docs.length, "Dokument", "Dokumente")} übergeben`);
}

$("#main").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  e.preventDefault();
  if (el.dataset.act === "view") return openViewer(Number(el.dataset.page));
  actionQueue = actionQueue.then(() => handleAction(el));
});

async function handleAction(el) {
  const job = state.job;
  const page = el.dataset.page != null ? Number(el.dataset.page) : null;
  const start = Number(el.closest("[data-start]")?.dataset.start);
  try {
    switch (el.dataset.act) {
      case "split": await toggleSplit(page); break;
      case "merge": await setLayout({ splits: job.splits.filter((s) => s !== page) }); break;
      case "confirm": {
        const d = job.documents.find((x) => x.start === start);
        await post(`/api/jobs/${job.id}/confirm`, { pages: d.uncertain_pages });
        break;
      }
      case "rotate": await rotatePage(page, 90); break;
      case "rotate-ccw": await rotatePage(page, -90); break;
      case "toggle-delete": await toggleDelete(page); break;
      case "upload": await post(`/api/jobs/${job.id}/documents/${start}/upload?target=paperless`); break;
      case "consume": await post(`/api/jobs/${job.id}/documents/${start}/upload?target=consume`); break;
      case "upload-all": await uploadMany("paperless"); break;
      case "consume-all": await uploadMany("consume"); break;
      case "use-suggestions": await post(`/api/jobs/${job.id}/use-suggestions`); toast("KI-Vorschlag wiederhergestellt"); break;
      case "analyze": {
        const res = await ask({
          title: "Neu analysieren",
          text: "Sollen nur Seiten ohne Ergebnis analysiert werden oder alle Seiten von vorn?\nDeine Trennstellen bleiben erhalten, solange du sie selbst gesetzt hast.",
          buttons: [{ label: "Abbrechen", value: "" }, { label: "Alle Seiten", value: "all" }, { label: "Nur fehlende", value: "missing", primary: true }],
        });
        if (!res) return;
        await post(`/api/jobs/${job.id}/analyze?reset=${res === "all"}`);
        break;
      }
      case "delete-job": {
        const res = await ask({
          title: "Scan entfernen?",
          text: `„${job.filename}“ und alle Korrekturen werden aus der App gelöscht.\nBereits hochgeladene Dokumente bleiben in Paperless.`,
          buttons: [{ label: "Abbrechen", value: "" }, { label: "Entfernen", value: "del", primary: true }],
        });
        if (res !== "del") return;
        await api(`/api/jobs/${job.id}`, { method: "DELETE" });
        state.jobId = null; state.job = null;
        history.replaceState(null, "", location.pathname);
        await loadJobs();
        renderEmpty();
        return;
      }
    }
  } catch (err) { fail(err); }
  await refresh(true);
  loadJobs();
}

$("#main").addEventListener("change", async (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (!field) return;
  const start = Number(el.closest("[data-start]").dataset.start);
  try { await put(`/api/jobs/${state.job.id}/documents/${start}`, { [field]: el.value.trim() || null }); }
  catch (err) { fail(err); }
  await refresh(true);
});
$("#main").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-field]")) e.target.blur(); });

// ===== Großansicht mit Tastatur-Workflow ===================================
const viewer = $("#viewer");
let viewIndex = 0;
let ocrOpen = false;
const ocrCache = {};

function openViewer(i) { viewIndex = i; viewer.hidden = false; renderViewer(); }
function closeViewer() { viewer.hidden = true; }

function renderViewer() {
  const job = state.job;
  const i = viewIndex;
  const page = job.pages[i];
  const docIdx = job.documents.findIndex((d) => d.pages.includes(i));
  const d = job.documents[docIdx];
  const posInDoc = d.active_pages.indexOf(i);
  const img = $(".viewer-stage img");
  const src = `/api/jobs/${job.id}/pages/${i}.jpg?size=large`;
  if (!img.src.endsWith(src)) img.src = src;
  img.style.transform = `rotate(${page.rotation}deg)`;
  img.style.opacity = page.deleted ? ".35" : "1";
  const a = page.analysis;
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
  $(".viewer-info").innerHTML = `
    <h3>Seite ${i + 1} <span class="muted">von ${job.pages.length}</span></h3>
    <div class="muted">Dokument ${docIdx + 1}${posInDoc >= 0 ? ` · Seite ${posInDoc + 1} von ${d.active_pages.length}` : ""}${page.deleted ? " · entfernt" : ""}${page.blank ? " · leer" : ""}</div>
    <dl>${a ? row("Absender", a.supplier) + row("Titel", a.title) + row("Datum", a.date) + row("Seitenangabe", a.page_marker) + row("KI-Sicherheit", `${Math.round(a.confidence * 100)} %`) : row("KI", page.error ? `Fehler: ${page.error}` : "noch nicht analysiert")}</dl>
    ${!page.blank ? `<details class="ocr" data-page="${i}"><summary data-tip="Zeigt den Text, den die KI für diese Seite gelesen hat – hilfreich, wenn eine Trennung falsch erkannt wurde.">Erkannter Text</summary><pre>…</pre></details>` : ""}`;
  const det = $(".viewer-info details.ocr");
  if (det) {
    // Offen bleiben, auch wenn die Ansicht beim Polling neu gezeichnet wird
    det.open = ocrOpen;
    const load = async () => {
      const key = `${job.id}:${i}:${page.has_text}`;
      try {
        ocrCache[key] ??= (await api(`/api/jobs/${job.id}/pages/${i}/text`)).text || "(kein Text erkannt)";
        $("pre", det).textContent = ocrCache[key];
      } catch (e) { $("pre", det).textContent = e.message; }
    };
    det.addEventListener("toggle", () => { ocrOpen = det.open; if (det.open) load(); });
    if (det.open) load();
  }
  const isStart = job.splits.includes(i);
  $(".viewer-actions").innerHTML = `
    ${isUnsure(page) && i > 0 ? `<button class="btn" data-vact="confirm" data-tip="Die KI war hier unsicher. Bestätigt, dass die Trennung an dieser Stelle so stimmt.">${icon("check")}Trennung passt<kbd>Enter</kbd></button>` : ""}
    ${i > 0 ? `<button class="btn" data-vact="split">${icon(isStart ? "merge" : "scissors")}${isStart ? "Zusammenführen" : "Neues Dokument ab hier"}<kbd>S</kbd></button>` : ""}
    <button class="btn" data-vact="rotate">${icon("rotate-cw")}Drehen<kbd>R</kbd></button>
    <button class="btn" data-vact="delete">${icon(page.deleted ? "undo" : "trash")}${page.deleted ? "Wiederherstellen" : "Seite entfernen"}<kbd>Entf</kbd></button>`;
  $(".viewer .prev").disabled = i === 0;
  $(".viewer .next").disabled = i === job.pages.length - 1;
}

// Schnelle Tastenfolgen nacheinander abarbeiten, damit keine Änderung verloren geht
let actionQueue = Promise.resolve();
function viewerAction(act) {
  const index = viewIndex;
  actionQueue = actionQueue.then(async () => {
    try {
      if (act === "confirm") await post(`/api/jobs/${state.job.id}/confirm`, { pages: [index] });
      if (act === "split") await toggleSplit(index);
      if (act === "rotate") await rotatePage(index, 90);
      if (act === "delete") await toggleDelete(index);
    } catch (e) { fail(e); }
    await refresh(true);
  });
  return actionQueue;
}
$(".viewer-actions").addEventListener("click", (e) => { const b = e.target.closest("[data-vact]"); if (b) viewerAction(b.dataset.vact); });
$(".viewer .close").onclick = closeViewer;
$(".viewer .prev").onclick = () => { if (viewIndex > 0) { viewIndex--; renderViewer(); } };
$(".viewer .next").onclick = () => { if (viewIndex < state.job.pages.length - 1) { viewIndex++; renderViewer(); } };
$(".viewer-stage").addEventListener("click", (e) => { if (e.target.classList.contains("viewer-stage")) closeViewer(); });
document.addEventListener("keydown", (e) => {
  if (viewer.hidden || $("#dialog").open) return;
  const k = e.key.toLowerCase();
  if (k === "escape") closeViewer();
  else if (k === "arrowleft") $(".viewer .prev").click();
  else if (k === "arrowright") $(".viewer .next").click();
  else if (k === "s" && viewIndex > 0) viewerAction("split");
  else if (k === "enter" && viewIndex > 0 && isUnsure(state.job.pages[viewIndex])) viewerAction("confirm");
  else if (k === "r") viewerAction("rotate");
  else if (k === "delete" || k === "backspace" || k === "d") viewerAction("delete");
  else return;
  e.preventDefault();
});

window.addEventListener("hashchange", async () => {
  const id = location.hash.slice(1);
  if (id && id !== state.jobId) { await loadJobs(); openJob(id); }
});

init().catch(fail);
