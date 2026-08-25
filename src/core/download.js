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

/** Folder for a job once its PCC is known: <parentDir>/<baseName>_<pcc> (or just <pcc>). */
function folderFor(job, pcc) {
  const leaf = job.baseName ? `${job.baseName}_${pcc}` : String(pcc);
  return path.join(job.parentDir, leaf);
}

/**
 * Build download jobs from resolved inventory items.
 * One folder per item, named by the PCC actually downloaded:
 *   <output>/<itemId>_<pcc>/<pcc>_0000n.png
 * @param {Array<{itemId:string,colorName:string,blColorId:string,pccs:string[]}>} resolved
 * @param {string} outputDir
 */
function inventoryJobs(resolved, outputDir) {
  const jobs = [];
  for (const r of resolved) {
    // All candidate PCCs newest-first; runJobs downloads the newest one that
    // actually has photos and names the folder after it.
    const pccs = sortPccsDesc(r.pccs);
    if (!pccs.length) continue;
    const color = r.colorName || r.blColorId;
    jobs.push({
      pccs,
      parentDir: outputDir,
      baseName: slug(r.itemId),
      label: `${r.itemId} · ${color}`,
      meta: {
        partNum: r.itemId,
        colorName: color,
        targetHex: r.colorHex || null,
        excludeColorId: r.rbColorId || null,
        source: r.source || 'csv',
      },
    });
  }
  return jobs;
}

/**
 * Build download jobs from BrickLink PCC rows. Folder named by PCC:
 *   <output>/<blId>/<pcc>/<pcc>_0000n.png
 * @param {string} blId
 * @param {Array<{colorName:string,pcc:string,pccs?:string[],hex?:string}>} pccRows
 * @param {string} outputDir
 */
function bricklinkJobs(blId, pccRows, outputDir) {
  const base = path.join(outputDir, slug(blId));
  return pccRows.map((row) => ({
    pccs: sortPccsDesc(row.pccs && row.pccs.length ? row.pccs : [row.pcc]),
    parentDir: base,
    baseName: '', // folder is just the PCC
    label: `${blId} · ${row.colorName}`,
    meta: {
      partNum: blId,
      colorName: row.colorName,
      targetHex: row.hex || null,
      donorPool: true, // donors come from the other scraped colours
    },
  }));
}

/**
 * Run download jobs with bounded concurrency. Each job carries candidate PCCs
 * newest-first; download the first that has photos, name its folder after it,
 * and stop. Combinations with zero photos are collected in `failed` (with their
 * meta, so the UI can offer to generate them).
 * @param {Array<{pccs:string[],parentDir:string,baseName:string,label:string,meta?:object}>} jobs
 * @param {object} [opts]
 * @returns {Promise<{totalSaved:number,totalMissing:number,partsOk:number,
 *   failed:Array<{label:string,pcc:string,meta?:object}>,perJob:Array}>}
 */
async function runJobs(jobs, opts = {}) {
  const { concurrency = 4, frames = 8, onProgress = () => {}, log = () => {}, signal } = opts;
  let done = 0;
  let totalSaved = 0;
  let totalMissing = 0;
  let partsOk = 0;
  const failed = [];

  const perJob = await mapLimit(jobs, concurrency, async (job) => {
    let chosen = null;
    let saved = [];
    let missing = [];
    for (const pcc of job.pccs) {
      if (signal?.aborted) break;
      const res = await downloadPccImages(pcc, folderFor(job, pcc), { frames, log, signal });
      if (res.saved.length > 0) { chosen = pcc; saved = res.saved; missing = res.missing; break; }
    }
    done++;
    totalSaved += saved.length;
    totalMissing += missing.length;
    if (chosen) partsOk++;
    else failed.push({ label: job.label, pcc: job.pccs.join('/'), meta: job.meta });
    onProgress({ done, total: jobs.length, label: job.label, saved: saved.length, missing: missing.length });
    return { ...job, pcc: chosen, saved, missing };
  });

  return { totalSaved, totalMissing, partsOk, failed, perJob };
}

module.exports = { inventoryJobs, bricklinkJobs, runJobs, slug };
