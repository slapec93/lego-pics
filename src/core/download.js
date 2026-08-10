'use strict';

const path = require('path');
const { downloadPccImages, mapLimit } = require('./images');

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
    const folder = path.join(outputDir, `${slug(r.itemId)}_${slug(r.colorName || r.blColorId)}`);
    for (const pcc of r.pccs) {
      jobs.push({ pcc, outDir: folder, label: `${r.itemId} ${r.colorName || ''} · ${pcc}` });
    }
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
    pcc: row.pcc,
    outDir: path.join(base, `${slug(row.colorName)}_${row.pcc}`),
    label: `${blId} ${row.colorName} · ${row.pcc}`,
  }));
}

/**
 * Run a list of download jobs with bounded concurrency, reporting progress.
 * @param {Array<{pcc:string,outDir:string,label:string}>} jobs
 * @param {object} [opts]
 * @param {number} [opts.concurrency=4]
 * @param {number} [opts.frames=8]
 * @param {(p:{done:number,total:number,label:string,saved:number,missing:number})=>void} [opts.onProgress]
 * @param {(msg:string)=>void} [opts.log]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{totalSaved:number, totalMissing:number, perJob:Array}>}
 */
async function runJobs(jobs, opts = {}) {
  const { concurrency = 4, frames = 8, onProgress = () => {}, log = () => {}, signal } = opts;
  let done = 0;
  let totalSaved = 0;
  let totalMissing = 0;

  const perJob = await mapLimit(jobs, concurrency, async (job) => {
    const res = await downloadPccImages(job.pcc, job.outDir, { frames, log, signal });
    done++;
    totalSaved += res.saved.length;
    totalMissing += res.missing.length;
    onProgress({
      done,
      total: jobs.length,
      label: job.label,
      saved: res.saved.length,
      missing: res.missing.length,
    });
    return { ...job, saved: res.saved, missing: res.missing };
  });

  return { totalSaved, totalMissing, perJob };
}

module.exports = { inventoryJobs, bricklinkJobs, runJobs, slug };
