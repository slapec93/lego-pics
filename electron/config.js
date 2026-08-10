'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'lego-pics-config.json');

const DEFAULTS = {
  elementsCsvPath: '',
  outputDir: '',
  concurrency: 4,
  lastXmlPath: '',
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const merged = { ...load(), ...patch };
  try {
    fs.writeFileSync(FILE(), JSON.stringify(merged, null, 2));
  } catch {
    /* best effort */
  }
  return merged;
}

module.exports = { load, save };
