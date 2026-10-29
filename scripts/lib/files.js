'use strict';
/*
 * files.js — staging copies of the app, local servers, and the read-only guarantee (C44, C45).
 *
 * - The harness never serves the repository itself: it copies only the app and data files into the
 *   scratch folder and serves that copy, so .env, .git/ and the docs are never on a local port.
 * - Servers use free ports and the harness waits until each one answers before using it (C4).
 * - treeFingerprint() hashes every file under the repository (except .git/ and the scratch folder;
 *   .env* files are compared by size and time only, never read) so the run can prove it changed nothing.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freePort, sleep } = require('./cdp');

// The files a browser needs. Everything else in the repository stays off the local servers.
const APP_FILES = ['index.html', 'backlog.html', 'quality-intake.html', 'dashboard.css', 'dashboard.js', 'sprint.js', 'backlog.js', 'quality-intake.js'];
const DATA_FILES = ['sprints.json', 'backlog.json', 'quality-intake.json'];
const SNAPSHOT_DIR = 'snapshots';

// Copies the app and data files of srcRoot into dest (only files that exist).
function stageRealApp(srcRoot, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, SNAPSHOT_DIR), { recursive: true });
  APP_FILES.concat(DATA_FILES).forEach(f => { if (fs.existsSync(path.join(srcRoot, f))) fs.copyFileSync(path.join(srcRoot, f), path.join(dest, f)); });
  const snapDir = path.join(srcRoot, SNAPSHOT_DIR);
  if (fs.existsSync(snapDir)) fs.readdirSync(snapDir).filter(f => /^sprint-\d+\.json$/.test(f)).forEach(f => fs.copyFileSync(path.join(snapDir, f), path.join(dest, SNAPSHOT_DIR, f)));
  return dest;
}

// Starts python3 -m http.server on a free port for dir and waits until it answers. Returns { port, url, stop }.
async function startServer(dir) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort();
    let exited = null;
    const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
    proc.on('exit', code => { exited = 'code ' + code; });
    proc.on('error', e => { exited = e.message; });
    const stop = () => { try { proc.kill(); } catch (e) { /* already gone */ } };
    const url = 'http://127.0.0.1:' + port + '/';
    for (let i = 0; i < 100 && !exited; i++) { // up to 10 s
      try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (r.status < 500) return { port, url, stop }; } catch (e) { /* not up yet */ }
      await sleep(100);
    }
    stop(); // the port was taken between freePort() and the bind, or python3 failed: try another port
    if (exited && /ENOENT/.test(exited)) throw new Error('python3 not found');
  }
  throw new Error('could not start a local server for ' + dir);
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// Fingerprint of every file under root: path -> content hash (or size+mtime for .env* files, which are never read).
function treeFingerprint(root, excludeAbs = []) {
  const out = {};
  const skip = new Set(excludeAbs.map(p => path.resolve(p)));
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const abs = path.join(dir, entry.name), rel = path.relative(root, abs);
      if (skip.has(abs) || entry.name === '.git') return;
      if (entry.isDirectory()) { walk(abs); return; }
      if (!entry.isFile()) return;
      if (/^\.env/.test(entry.name)) { const st = fs.statSync(abs); out[rel] = 'stat:' + st.size + ':' + st.mtimeMs; return; }
      out[rel] = sha256(abs);
    });
  })(root);
  return out;
}
function diffFingerprints(a, b) {
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  return [...keys].filter(k => a[k] !== b[k]).sort();
}

// The tracker workbook, if it can be found: AF_TRACKER_PATH, then the older AF_SNAPLOGIC_TRACKER,
// then $AF_SNAPLOGIC_ROOT/03_Team_Enablement/daily_tracker.xlsx, then the usual Google Drive location.
// Returns null when there is no tracker on this machine (the check is then skipped, not failed).
function findTracker() {
  const rel = path.join('03_Team_Enablement', 'daily_tracker.xlsx');
  const candidates = [process.env.AF_TRACKER_PATH, process.env.AF_SNAPLOGIC_TRACKER,
    process.env.AF_SNAPLOGIC_ROOT && path.join(process.env.AF_SNAPLOGIC_ROOT, rel)].filter(Boolean);
  const cloud = path.join(os.homedir(), 'Library', 'CloudStorage');
  if (fs.existsSync(cloud)) {
    fs.readdirSync(cloud).filter(d => /^GoogleDrive-/.test(d)).forEach(d => candidates.push(path.join(cloud, d, 'My Drive', 'AF_Snaplogic', rel)));
  }
  const explicit = !!(process.env.AF_TRACKER_PATH || process.env.AF_SNAPLOGIC_TRACKER || process.env.AF_SNAPLOGIC_ROOT);
  const found = candidates.find(f => fs.existsSync(f)) || null;
  return { file: found, explicit, tried: candidates.length };
}
function statSignature(file) { const st = fs.statSync(file); return st.size + ':' + st.mtimeMs; }

module.exports = { APP_FILES, DATA_FILES, stageRealApp, startServer, treeFingerprint, diffFingerprints, findTracker, statSignature };
