'use strict';

const path = require('path');
const { downloadPccImages, mapLimit } = require('./images');
const { sortPccsDesc } = require('./pcc');

/** Make a filesystem-safe folder/file fragment. */
function slug(s) {
  return String(s == null ? '' : s)
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'x';
}

/**
 * Build download jobs from resolved inventory items.
 * One folder per item+colour:  <output>/<itemId>_<color>/<pcc>_0000n.png
 * @param {Array<{itemId:string,colorName:string,blColorId:string,pccs:string[]}>} resolved
 * @param {string} outputDir
 * @returns {Array<{pcc:string, outDir:string, label:string}>}
 */
function inventoryJobs(resolved, outputDir) {
  const jobs = [];
  for (const r of resolved) {
    // Carry all candidate PCCs newest-first; runJobs downloads the newest one
    // that actually has photos (avoids duplicate image sets without missing
    // images when the newest element has none but an older one does).
    const pccs = sortPccsDesc(r.pccs);
    if (!pccs.length) continue;
    const color = r.colorName || r.blColorId;
    jobs.push({
      pccs,
      outDir: path.join(outputDir, `${slug(r.itemId)}_${slug(color)}`),
      label: `${r.itemId} · ${color}`,
    });
  }
  return jobs;
}

/**
 * Build download jobs from BrickLink PCC rows.
 * One folder per colour+pcc:  <output>/<blId>/<color>_<pcc>/<pcc>_0000n.png
 * @param {string} blId
 * @param {Array<{colorName:string,pcc:string}>} pccRows
 * @param {string} outputDir
 */
function bricklinkJobs(blId, pccRows, outputDir) {
  const base = path.join(outputDir, slug(blId));
  return pccRows.map((row) => ({
    pccs: sortPccsDesc(row.pccs && row.pccs.length ? row.pccs : [row.pcc]),
    outDir: path.join(base, slug(row.colorName)),
    label: `${blId} · ${row.colorName}`,
  }));
}

/**
 * Run a list of download jobs with bounded concurrency, reporting progress.
 * Each job carries candidate PCCs newest-first; we download the first one that
 * has photos and stop.
 * @param {Array<{pccs:string[],outDir:string,label:string}>} jobs
 * @param {object} [opts]
 * @param {number} [opts.concurrency=4]
 * @param {number} [opts.frames=8]
 * @param {(p:{done:number,total:number,label:string,saved:number,missing:number})=>void} [opts.onProgress]
 * @param {(msg:string)=>void} [opts.log]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{totalSaved:number, totalMissing:number, partsOk:number,
 *   failed:Array<{label:string,pcc:string}>, perJob:Array}>}
 */
async function runJobs(jobs, opts = {}) {
  const { concurrency = 4, frames = 8, onProgress = () => {}, log = () => {}, signal } = opts;
  let done = 0;
  let totalSaved = 0;
  let totalMissing = 0;
  let partsOk = 0;
  const failed = []; // part+colour combinations that yielded zero images

  const perJob = await mapLimit(jobs, concurrency, async (job) => {
    // Try newest PCC first; fall back to older ones only if the newer has no
    // photos. Stop at the first PCC that yields at least one image.
    let chosen = null;
    let saved = [];
    let missing = [];
    for (const pcc of job.pccs) {
      if (signal?.aborted) break;
      const res = await downloadPccImages(pcc, job.outDir, { frames, log, signal });
      if (res.saved.length > 0) { chosen = pcc; saved = res.saved; missing = res.missing; break; }
    }
    done++;
    totalSaved += saved.length;
    totalMissing += missing.length;
    if (chosen) partsOk++;
    else failed.push({ label: job.label, pcc: job.pccs.join('/') });
    onProgress({
      done,
      total: jobs.length,
      label: job.label,
      saved: saved.length,
      missing: missing.length,
    });
    return { ...job, pcc: chosen, saved, missing };
  });

  return { totalSaved, totalMissing, partsOk, failed, perJob };
}

module.exports = { inventoryJobs, bricklinkJobs, runJobs, slug };
