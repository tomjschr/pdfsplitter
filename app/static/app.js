"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { config: null, jobs: [], job: null, jobId: null, correspondents: [], pollTimer: null };

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

function toast(msg) { alert(msg); }

// --- Start --------------------------------------------------------------
async function init() {
  state.config = await api("/api/config");
  renderPills();
  if (state.config.paperless_configured) {
    try { state.correspondents = await api("/api/correspondents"); } catch (e) { console.warn(e); }
  }
  await loadJobs();
  const fromHash = location.hash.slice(1);
  if (fromHash) openJob(fromHash);
}

function renderPills() {
  const c = state.config;
  $("#status-pills").innerHTML =
    `<span class="pill ${c.paperless_configured ? "on" : "off"}" title="${esc(c.paperless_url)}">Paperless ${c.paperless_configured ? "✓" : "nicht konfiguriert"}</span>` +
    `<span class="pill ${c.llm_configured ? "on" : "off"}">KI: ${c.llm_configured ? esc(c.llm_model) : "aus"}</span>` +
    `<span class="pill ${c.consume_configured ? "on" : ""}">Consume-Ordner ${c.consume_configured ? "✓" : "–"}</span>`;
}

// --- Upload -------------------------------------------------------------
const dz = $("#dropzone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); uploadFiles(e.dataTransfer.files); });
$("#file-input").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });

async function uploadFiles(files) {
  let lastId = null;
  for (const f of files) {
    $("#upload-progress").textContent = `Lade ${f.name} hoch …`;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("duplex", $("#duplex").checked);
    try { lastId = (await api("/api/jobs", { method: "POST", body: fd })).id; }
    catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  $("#upload-progress").textContent = "";
  await loadJobs();
  if (lastId) openJob(lastId);
}

// --- Jobliste -----------------------------------------------------------
const STATUS = { rendering: "Leerseiten-Erkennung …", analyzing: "Analysiere …", ready: "bereit" };

async function loadJobs() {
  state.jobs = await api("/api/jobs");
  $("#job-list").innerHTML = state.jobs.map((j) => `
    <li data-id="${j.id}" class="${j.id === state.jobId ? "active" : ""}">
      <div class="name">${esc(j.filename)}</div>
      <div class="meta">${j.progress.total} Seiten · ${j.documents} Dok. · ${j.uploaded} hochgeladen ·
        ${j.status === "ready" ? STATUS.ready : `${STATUS[j.status]} ${j.progress.done}/${j.progress.total}`}</div>
    </li>`).join("") || `<li class="meta">Noch keine Scans</li>`;
}
$("#job-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) openJob(li.dataset.id);
});

async function openJob(id) {
  state.jobId = id;
  location.hash = id;
  await refresh(true);
  loadJobs();
}

async function refresh(force = false) {
  clearTimeout(state.pollTimer);
  if (!state.jobId) return;
  try {
    state.job = await api(`/api/jobs/${state.jobId}`);
  } catch (e) {
    state.jobId = null; state.job = null; location.hash = "";
    $("#main").innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    return;
  }
  // Nicht neu zeichnen, während der Nutzer in einem Feld tippt
  const active = document.activeElement;
  const editing = active && $("#main").contains(active) && ["INPUT", "SELECT"].includes(active.tagName);
  if (force || !editing) renderJob();
  if (needsPolling(state.job)) {
    state.pollTimer = setTimeout(() => { refresh(); loadJobs(); }, 2000);
  }
}

function needsPolling(job) {
  return job.status !== "ready" || job.documents.some((d) => d.upload && ["uploading", "queued"].includes(d.upload.status));
}

// --- Jobansicht ---------------------------------------------------------
function renderJob() {
  const job = state.job;
  const p = job.progress;
  const busy = job.status !== "ready";
  const sameSuggestion = JSON.stringify(job.splits) === JSON.stringify(job.suggested_splits);
  const pending = job.documents.filter((d) => d.active_pages.length && (!d.upload || ["failure"].includes(d.upload.status) || d.changed_since_upload));
  const scrollY = window.scrollY;

  $("#main").innerHTML = `
    <div class="toolbar">
      <h2>${esc(job.filename)}</h2>
      ${job.splits_edited && !sameSuggestion && job.suggested_splits.length ? `<button data-act="use-suggestions" title="Deine manuellen Trennstellen verwerfen">KI-Vorschlag übernehmen</button>` : ""}
      <button data-act="analyze" ${busy || !state.config.llm_configured ? "disabled" : ""}>Neu analysieren</button>
      ${state.config.paperless_configured ? `<button class="primary" data-act="upload-all" ${busy || !pending.length ? "disabled" : ""}>Alle ${pending.length} nach Paperless</button>` : ""}
      ${state.config.consume_configured ? `<button data-act="consume-all" ${busy || !pending.length ? "disabled" : ""}>Alle in Consume-Ordner</button>` : ""}
      <button data-act="delete-job" title="Scan aus der Liste löschen">🗑</button>
    </div>
    ${busy ? `<div>${STATUS[job.status]} Seite ${p.done} von ${p.total}</div><div class="progress"><div style="width:${p.total ? (100 * p.done) / p.total : 0}%"></div></div>` : ""}
    ${job.message ? `<div class="notice">${esc(job.message)}</div>` : ""}
    ${job.paperless_error ? `<div class="notice error">Paperless nicht erreichbar: ${esc(job.paperless_error)}</div>` : ""}
    ${job.documents.map((d, n) => renderDoc(job, d, n)).join("")}
  `;
  window.scrollTo(0, scrollY);
}

function renderDoc(job, d, n) {
  const up = d.upload;
  const done = up && up.status === "success" && !d.changed_since_upload;
  const pagesHtml = d.pages.map((i, k) => {
    const page = job.pages[i];
    const unsure = !page.blank && page.analysis && page.analysis.confidence < 0.7;
    const gap = k > 0 ? `<div class="gap ${unsure ? "uncertain" : ""}" data-act="split" data-page="${i}" title="${unsure ? "KI unsicher – prüfen! " : ""}Neues Dokument ab Seite ${i + 1}">${unsure ? "✂?" : "✂"}</div>` : "";
    return gap + renderPage(job, page, i);
  }).join("");
  return `
    <section class="doc ${n % 2 ? "alt" : ""} ${d.uncertain ? "uncertain" : ""} ${done ? "done" : ""}" data-start="${d.start}">
      <div class="doc-head">
        <span class="num">Dokument ${n + 1}<br><span class="supplier">${d.active_pages.length} Seite(n)</span></span>
        ${d.start > 0 ? `<button data-act="merge" data-page="${d.start}" title="Mit vorherigem Dokument zusammenführen">⤒ Zusammenführen</button>` : ""}
        ${d.uncertain ? `<span class="badge uncertain" title="Die KI war sich bei dieser Trennstelle unsicher">Trennung unsicher</span>` : ""}
        ${renderCorrespondent(d)}
        <input class="title" data-field="title" placeholder="Titel" value="${esc(d.title)}">
        <input type="date" data-field="date" value="${esc(d.date)}">
        <a class="btn" href="/api/jobs/${job.id}/documents/${d.start}.pdf" target="_blank" title="PDF ansehen">PDF</a>
        ${state.config.paperless_configured ? `<button class="${done ? "" : "primary"}" data-act="upload" ${job.status !== "ready" || !d.active_pages.length ? "disabled" : ""}>${done ? "Erneut" : "Hochladen"}</button>` : ""}
        ${state.config.consume_configured ? `<button data-act="consume" ${!d.active_pages.length ? "disabled" : ""} title="Ohne Metadaten in den Consume-Ordner kopieren">→ Consume</button>` : ""}
        ${renderUpload(d)}
      </div>
      <div class="pages">${pagesHtml}</div>
    </section>`;
}

function renderPage(job, page, i) {
  const a = page.analysis;
  const info = a ? [a.supplier, a.title, a.page_marker, a.confidence != null ? `Sicherheit ${Math.round(a.confidence * 100)} %` : null].filter(Boolean).join(" · ") : page.error ? `Fehler: ${page.error}` : "";
  const side = job.duplex ? (i % 2 ? "R" : "V") : "";
  return `
    <div class="page ${page.deleted ? "deleted" : ""}" data-page="${i}" title="${esc(info)}">
      ${page.blank ? `<span class="flag">leer</span>` : ""}
      <div class="tools">
        <button data-act="rotate" data-page="${i}" title="Drehen">⟳</button>
        <button data-act="toggle-delete" data-page="${i}" title="${page.deleted ? "Wiederherstellen" : "Entfernen"}">${page.deleted ? "↺" : "✕"}</button>
      </div>
      <div class="thumb" data-act="view" data-page="${i}">
        <img loading="lazy" class="r${page.rotation}" style="transform:rotate(${page.rotation}deg)" src="/api/jobs/${job.id}/pages/${i}.jpg" alt="Seite ${i + 1}">
      </div>
      <div class="label">S. ${i + 1}${side ? ` (${side})` : ""}${page.error ? " ⚠" : ""}</div>
    </div>`;
}

function renderCorrespondent(d) {
  if (!state.config.paperless_configured) {
    return d.supplier ? `<span class="badge">Lieferant: ${esc(d.supplier)}</span>` : "";
  }
  const m = d.match;
  let badge = "";
  if (!d.correspondent_edited && m) {
    if (m.status === "exact") badge = `<span class="badge exact" title="In Paperless vorhanden">✓ vorhanden</span>`;
    else if (m.status === "similar") badge = `<span class="badge similar" title="Erkannt: ${esc(d.supplier)}">≈ ähnlich (${m.best.score} %)</span>`;
    else if (m.status === "new") badge = `<span class="badge new" title="Nicht in Paperless gefunden">neu: ${esc(d.supplier)}</span>`;
  }
  const sugIds = new Set((m?.suggestions || []).map((s) => s.id));
  const opt = (c) => `<option value="${c.id}" ${c.id === d.correspondent_id ? "selected" : ""}>${esc(c.name)}</option>`;
  const suggestions = (m?.suggestions || []).map((s) => `<option value="${s.id}" ${s.id === d.correspondent_id ? "selected" : ""}>${esc(s.name)} (${s.score} %)</option>`).join("");
  const rest = state.correspondents.filter((c) => !sugIds.has(c.id)).map(opt).join("");
  const newLabel = d.supplier && m?.status !== "exact" ? `➕ Neu anlegen: ${esc(d.supplier)}` : "➕ Neu anlegen …";
  return `
    <select data-field="correspondent" title="${d.supplier ? `Erkannt: ${esc(d.supplier)}` : "Kein Lieferant erkannt"}">
      <option value="" ${d.correspondent_id == null ? "selected" : ""}>— kein Korrespondent —</option>
      <option value="__new__">${newLabel}</option>
      ${suggestions ? `<optgroup label="Vorschläge">${suggestions}</optgroup>` : ""}
      <optgroup label="Alle">${rest}</optgroup>
    </select>${badge}`;
}

function renderUpload(d) {
  const up = d.upload;
  if (!up) return "";
  const labels = { uploading: "lädt hoch …", queued: "in Verarbeitung …", success: "✓ hochgeladen", failure: "Fehler", duplicate: "Duplikat" };
  let link = "";
  if (up.status === "success" && up.document_id && state.config.paperless_url) {
    link = ` <a href="${esc(state.config.paperless_url)}/documents/${up.document_id}/details" target="_blank">öffnen</a>`;
  }
  const changed = d.changed_since_upload ? ` <span class="badge similar">seitdem geändert</span>` : "";
  return `<span class="badge ${up.status}" title="${esc(up.message)}">${labels[up.status] || up.status}</span>${link}${changed}`;
}

// --- Aktionen -----------------------------------------------------------
$("#main").addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const job = state.job;
  const page = el.dataset.page != null ? Number(el.dataset.page) : null;
  const start = Number(el.closest("[data-start]")?.dataset.start);
  try {
    switch (el.dataset.act) {
      case "split":
        await put(`/api/jobs/${job.id}/layout`, { splits: [...job.splits, page] });
        break;
      case "merge":
        await put(`/api/jobs/${job.id}/layout`, { splits: job.splits.filter((s) => s !== page) });
        break;
      case "rotate":
      case "toggle-delete": {
        const pages = job.pages.map((p) => ({ deleted: p.deleted, rotation: p.rotation }));
        if (el.dataset.act === "rotate") pages[page].rotation = (pages[page].rotation + 90) % 360;
        else pages[page].deleted = !pages[page].deleted;
        await put(`/api/jobs/${job.id}/layout`, { pages });
        break;
      }
      case "view":
        openViewer(page);
        return;
      case "upload":
      case "consume":
        await post(`/api/jobs/${job.id}/documents/${start}/upload?target=${el.dataset.act === "upload" ? "paperless" : "consume"}`);
        break;
      case "upload-all":
      case "consume-all": {
        const target = el.dataset.act === "upload-all" ? "paperless" : "consume";
        const docs = job.documents.filter((d) => d.active_pages.length && (!d.upload || d.upload.status === "failure" || d.changed_since_upload));
        const noCorr = docs.filter((d) => target === "paperless" && d.correspondent_id == null).length;
        if (!confirm(`${docs.length} Dokument(e) hochladen?${noCorr ? `\n${noCorr} davon ohne Korrespondent.` : ""}`)) return;
        for (const d of docs) await post(`/api/jobs/${job.id}/documents/${d.start}/upload?target=${target}`);
        break;
      }
      case "analyze":
        await post(`/api/jobs/${job.id}/analyze?reset=${confirm("Alle Seiten komplett neu analysieren?\n(Abbrechen = nur fehlende Seiten)")}`);
        break;
      case "use-suggestions":
        await post(`/api/jobs/${job.id}/use-suggestions`);
        break;
      case "delete-job":
        if (!confirm("Diesen Scan inkl. aller Bearbeitungen löschen? (Bereits hochgeladene Dokumente bleiben in Paperless.)")) return;
        await api(`/api/jobs/${job.id}`, { method: "DELETE" });
        state.jobId = null; state.job = null; location.hash = "";
        $("#main").innerHTML = "";
        await loadJobs();
        return;
    }
  } catch (err) {
    toast(err.message);
  }
  await refresh(true);
  loadJobs();
});

$("#main").addEventListener("change", async (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (!field) return;
  const start = Number(el.closest("[data-start]").dataset.start);
  const doc = state.job.documents.find((d) => d.start === start);
  try {
    if (field === "correspondent") {
      let id = el.value === "" ? null : el.value;
      if (id === "__new__") {
        const name = prompt("Name des neuen Korrespondenten in Paperless:", doc.supplier || "");
        if (!name || !name.trim()) { await refresh(true); return; }
        const created = await post("/api/correspondents", { name: name.trim() });
        state.correspondents = await api("/api/correspondents");
        id = created.id;
      }
      await put(`/api/jobs/${state.job.id}/documents/${start}`, { correspondent_id: id == null ? null : Number(id) });
    } else {
      await put(`/api/jobs/${state.job.id}/documents/${start}`, { [field]: el.value.trim() || null });
    }
  } catch (err) {
    toast(err.message);
  }
  el.blur();
  await refresh(true);
});

// --- Großansicht --------------------------------------------------------
const viewer = $("#viewer");
let viewIndex = 0;
function openViewer(i) {
  viewIndex = i;
  const page = state.job.pages[i];
  const img = $("img", viewer);
  img.src = `/api/jobs/${state.job.id}/pages/${i}.jpg?size=large`;
  img.style.transform = `rotate(${page.rotation}deg)`;
  const a = page.analysis;
  $(".caption", viewer).textContent = `Seite ${i + 1} von ${state.job.pages.length}` +
    (page.deleted ? " · entfernt" : "") + (a ? ` · ${[a.supplier, a.title, a.date, a.page_marker].filter(Boolean).join(" · ")}` : "");
  viewer.hidden = false;
}
const closeViewer = () => { viewer.hidden = true; };
$(".close", viewer).onclick = closeViewer;
$(".prev", viewer).onclick = () => viewIndex > 0 && openViewer(viewIndex - 1);
$(".next", viewer).onclick = () => viewIndex < state.job.pages.length - 1 && openViewer(viewIndex + 1);
viewer.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });
document.addEventListener("keydown", (e) => {
  if (viewer.hidden) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") $(".prev", viewer).click();
  if (e.key === "ArrowRight") $(".next", viewer).click();
});

init();
