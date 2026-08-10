'use strict';

const $ = (id) => document.getElementById(id);
const ipc = window.api;

let cfg = {};
let currentRunId = null;
let blRows = [];

function setStatus(text) { $('status').textContent = text; }
function setBar(done, total) { $('bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function busy(on, runId) {
  currentRunId = on ? runId : null;
  $('cancelBtn').disabled = !on;
  for (const b of ['analyzeBtn', 'downloadInvBtn', 'lookupBtn', 'downloadBlBtn']) $(b).disabled = on;
}

// ---------- init ----------
async function init() {
  cfg = await ipc.getConfig();
  $('csvPath').value = cfg.elementsCsvPath || '';
  $('outputDir').value = cfg.outputDir || '';
  $('concurrency').value = cfg.concurrency || 4;
  $('xmlPath').value = cfg.lastXmlPath || '';
  $('colorsBadge').textContent = cfg.colorsAvailable ? '✓ colour database loaded' : '⚠ colour database missing';
  $('colorsBadge').style.color = cfg.colorsAvailable ? 'var(--ok)' : 'var(--err)';

  ipc.onLog((msg) => {
    const el = $('logOutput');
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
  });
  ipc.onProgress((p) => {
    setBar(p.done, p.total);
    setStatus(`${p.done}/${p.total} — ${p.label} (${p.saved} imgs${p.missing ? `, ${p.missing} missing` : ''})`);
  });
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('tab-inv').classList.toggle('hidden', t.dataset.tab !== 'inv');
    $('tab-bl').classList.toggle('hidden', t.dataset.tab !== 'bl');
  });
});

// ---------- settings ----------
$('pickCsv').onclick = async () => {
  const p = await ipc.pickCsv();
  if (p) { $('csvPath').value = p; cfg = await ipc.setConfig({ elementsCsvPath: p }); }
};
$('pickOutput').onclick = async () => {
  const p = await ipc.pickOutput();
  if (p) { $('outputDir').value = p; cfg = await ipc.setConfig({ outputDir: p }); }
};
$('openOutput').onclick = () => ipc.openPath($('outputDir').value);
$('concurrency').onchange = () => ipc.setConfig({ concurrency: Number($('concurrency').value) || 4 });

// ---------- mode 1: inventory ----------
let lastResolve = null;

$('pickXml').onclick = async () => {
  const p = await ipc.pickXml();
  if (p) { $('xmlPath').value = p; ipc.setConfig({ lastXmlPath: p }); }
};

$('analyzeBtn').onclick = async () => {
  const xmlPath = $('xmlPath').value;
  const csvPath = $('csvPath').value;
  if (!xmlPath) return alert('Pick an inventory XML first.');
  if (!csvPath) return alert('Pick elements.csv first.');
  busy(true, 'analyze');
  setStatus('Analyzing…');
  try {
    const r = await ipc.resolveInventory({ xmlPath, csvPath });
    lastResolve = r;
    renderInvResult(r);
    $('invSummary').textContent = `${r.resolved.length}/${r.itemCount} items matched · ${r.pccCount} PCC(s)`;
    $('downloadInvBtn').disabled = r.pccCount === 0;
  } catch (e) {
    alert('Analyze failed: ' + e.message);
  } finally {
    busy(false);
    setStatus('Idle');
  }
};

function renderInvResult(r) {
  const rows = [];
  for (const it of r.resolved) {
    rows.push(`<tr><td>${esc(it.itemId)}</td><td>${esc(it.colorName || it.blColorId)}</td>
      <td><span class="tag ok">${it.pccs.length} PCC</span></td><td>${esc(it.pccs.join(', '))}</td></tr>`);
  }
  for (const it of r.unresolved) {
    rows.push(`<tr><td>${esc(it.itemId)}</td><td>${esc(it.blColorId)}</td>
      <td><span class="tag miss">miss</span></td><td>${esc(it.reason)}</td></tr>`);
  }
  $('invResult').innerHTML = `<table><thead><tr><th>Item</th><th>Color</th><th>Status</th><th>Detail</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

$('downloadInvBtn').onclick = async () => {
  const xmlPath = $('xmlPath').value;
  const csvPath = $('csvPath').value;
  const outputDir = $('outputDir').value;
  if (!outputDir) return alert('Pick an output folder first.');
  const runId = 'inv-' + Date.now();
  busy(true, runId);
  setStatus('Downloading…');
  try {
    const s = await ipc.downloadInventory({ xmlPath, csvPath, outputDir, concurrency: $('concurrency').value, runId });
    setStatus(s.canceled ? `Canceled — ${s.totalSaved} images saved` : `Done — ${s.totalSaved} images across ${s.jobCount} parts (${s.totalMissing} frames absent)`);
  } catch (e) {
    alert('Download failed: ' + e.message);
    setStatus('Failed');
  } finally {
    busy(false);
  }
};

// ---------- mode 2: bricklink ----------
$('lookupBtn').onclick = async () => {
  const blId = $('blId').value.trim();
  if (!blId) return alert('Enter a BrickLink part ID.');
  busy(true, 'lookup');
  setStatus('Scraping BrickLink…');
  $('blResult').innerHTML = '';
  try {
    const r = await ipc.previewBricklink({ blId });
    blRows = r.rows;
    renderBlResult(r.rows);
    $('blSummary').textContent = `${r.rows.length} colour/PCC entries`;
    $('downloadBlBtn').disabled = r.rows.length === 0;
  } catch (e) {
    alert('Lookup failed: ' + e.message);
  } finally {
    busy(false);
    setStatus('Idle');
  }
};

function renderBlResult(rows) {
  const body = rows.map((row, i) =>
    `<tr><td><input type="checkbox" class="blchk" data-i="${i}" checked /></td>
     <td>${esc(row.colorName)}</td><td>${esc(row.pcc)}</td></tr>`).join('');
  $('blResult').innerHTML = `<table><thead><tr><th></th><th>Color</th><th>PCC</th></tr></thead><tbody>${body}</tbody></table>`;
  $('blSelectAll').checked = true;
}

$('blSelectAll').onchange = () => {
  document.querySelectorAll('.blchk').forEach((c) => { c.checked = $('blSelectAll').checked; });
};

$('downloadBlBtn').onclick = async () => {
  const outputDir = $('outputDir').value;
  if (!outputDir) return alert('Pick an output folder first.');
  const selected = Array.from(document.querySelectorAll('.blchk'))
    .filter((c) => c.checked).map((c) => blRows[Number(c.dataset.i)]);
  if (!selected.length) return alert('Select at least one colour.');
  const runId = 'bl-' + Date.now();
  busy(true, runId);
  setStatus('Downloading…');
  try {
    const s = await ipc.downloadBricklink({ blId: $('blId').value.trim(), rows: selected, outputDir, concurrency: $('concurrency').value, runId });
    setStatus(s.canceled ? `Canceled — ${s.totalSaved} images saved` : `Done — ${s.totalSaved} images across ${s.jobCount} colours (${s.totalMissing} frames absent)`);
  } catch (e) {
    alert('Download failed: ' + e.message);
    setStatus('Failed');
  } finally {
    busy(false);
  }
};

// ---------- cancel ----------
$('cancelBtn').onclick = () => { if (currentRunId) ipc.cancelRun(currentRunId); setStatus('Canceling…'); };

init();
