/**
 * installer.js
 *
 * Core install logic for bruget. Handles downloading, extracting, and launching
 * Bruno app versions across macOS, Linux, and Windows.
 *
 * Stable release asset naming (from usebruno/bruno GitHub releases):
 *   macOS  : bruno_<version>_<arch>_mac.zip      (arch: x64 | arm64)
 *   Linux  : bruno_<version>_<arch>_linux.AppImage (arch: x86_64 | arm64)
 *   Windows: bruno_<version>_<arch>_win.zip       (arch: x64 | arm64)
 *
 * Nightly release asset naming (from usebruno/bruno-nightly-builds):
 *   macOS  : bruno_<version>_<arch>_mac.dmg       (DMG used instead of ZIP for nightly)
 *   Linux  : bruno_<version>_<arch>_linux.AppImage
 *   Windows: bruno_<version>_<arch>_win.zip
 *
 * Install dir layout (all platforms): ~/Downloads/bet-temp/bruno-versions/
 *   macOS  → Bruno-<version>.app
 *   Linux  → Bruno-<version>.AppImage
 *   Windows→ Bruno-<version>/  (folder containing Bruno.exe)
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');
const extract = require('extract-zip');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const NIGHTLY_REPO = 'usebruno/bruno-nightly-builds';
const GITHUB_API = 'https://api.github.com';

/**
 * Detects the current platform and architecture, and maps them to the exact
 * strings used in Bruno's GitHub release asset filenames.
 *
 * Linux renames x64 → x86_64 because Bruno's release assets use the Linux
 * convention (x86_64) rather than Node's process.arch value (x64).
 *
 * Returns:
 *   os          - 'mac' | 'linux' | 'win'  (matches Bruno filename suffix)
 *   arch        - arch string as used in Bruno filenames
 *   stableFormat- file extension for stable releases
 *   nightlyFormat-file extension for nightly releases
 */
function getPlatformInfo() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    if (arch !== 'x64' && arch !== 'arm64') throw new Error(`Unsupported macOS arch: ${arch}`);
    // Stable uses ZIP; nightly uses DMG (mounted via hdiutil)
    return { os: 'mac', arch, stableFormat: 'zip', nightlyFormat: 'dmg' };
  }

  if (platform === 'linux') {
    // Bruno Linux assets use 'x86_64' not 'x64' (standard Linux naming)
    if (arch === 'x64') return { os: 'linux', arch: 'x86_64', stableFormat: 'AppImage', nightlyFormat: 'AppImage' };
    if (arch === 'arm64') return { os: 'linux', arch: 'arm64', stableFormat: 'AppImage', nightlyFormat: 'AppImage' };
    throw new Error(`Unsupported Linux arch: ${arch}`);
  }

  if (platform === 'win32') {
    if (arch === 'x64' || arch === 'arm64') return { os: 'win', arch, stableFormat: 'zip', nightlyFormat: 'zip' };
    throw new Error(`Unsupported Windows arch: ${arch}`);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Recursively searches for Bruno.app (macOS app bundle) starting from `dir`.
 * Bruno's ZIP may extract into a nested folder, so depth-first search is needed.
 * Returns the full path to Bruno.app, or null if not found within 4 levels.
 */
async function findApp(dir, depth = 0) {
  if (depth > 4) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'Bruno.app' && entry.isDirectory()) {
      return path.join(dir, entry.name);
    }
    if (entry.isDirectory()) {
      const found = await findApp(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recursively searches for Bruno.exe inside a Windows extracted folder.
 * The ZIP may extract to a nested subfolder, so we search up to 4 levels deep.
 * Returns the full path to Bruno.exe, or null if not found.
 */
async function findExe(dir, depth = 0) {
  if (depth > 4) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'Bruno.exe' && !entry.isDirectory()) {
      return path.join(dir, entry.name);
    }
    if (entry.isDirectory()) {
      const found = await findExe(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns the expected filesystem path for an installed Bruno version.
 *
 * macOS  : <targetDir>/Bruno-<version>.app     (app bundle directory)
 * Linux  : <targetDir>/Bruno-<version>.AppImage (executable file)
 * Windows: <targetDir>/Bruno-<version>          (extracted folder with Bruno.exe inside)
 */
function getInstalledPath(targetDir, label, osName) {
  if (osName === 'mac') return path.join(targetDir, `${label}.app`);
  if (osName === 'linux') return path.join(targetDir, `${label}.AppImage`);
  if (osName === 'win') return path.join(targetDir, label);
  throw new Error(`Unknown OS: ${osName}`);
}

/**
 * Launches an installed Bruno app in the background (non-blocking).
 *
 * macOS  : uses `open` command — handles .app bundles natively
 * Linux  : spawns the AppImage directly as a detached process
 * Windows: locates Bruno.exe inside the install folder, then spawns it detached
 *
 * Errors are silently swallowed — launch failure shouldn't abort the install.
 */
async function openApp(installedPath, osName) {
  if (osName === 'mac') {
    await execAsync(`open "${installedPath}"`).catch(() => {});
  } else if (osName === 'linux') {
    spawn(installedPath, [], { detached: true, stdio: 'ignore' }).unref();
  } else if (osName === 'win') {
    // findExe searches recursively in case the ZIP extracted to a subfolder
    const exePath = await findExe(installedPath).catch(() => null);
    if (exePath) {
      spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
    }
  }
}

/**
 * Downloads a file from `url` and writes it to `destPath`.
 * Throws on non-2xx HTTP response.
 */
async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}. Check that the release/asset exists.`);
  }
  const buffer = await response.buffer();
  await fs.writeFile(destPath, buffer);
}

/**
 * Extracts/installs a downloaded Bruno asset to its final versioned path.
 * Behavior differs per platform:
 *
 * mac + zip:
 *   1. Extract ZIP into targetDir (Bruno.app lands somewhere inside)
 *   2. Search for Bruno.app recursively
 *   3. Delete the ZIP
 *   4. Rename Bruno.app → <installedPath>
 *
 * mac + dmg (nightly only):
 *   1. Mount DMG via `hdiutil attach` into a temp mountpoint
 *   2. Copy Bruno.app out of the mounted volume (always unmount in finally block)
 *   3. Delete the DMG
 *
 * linux + AppImage:
 *   1. Rename the downloaded file to its versioned name
 *   2. chmod 755 so it's executable (downloads have no execute bit)
 *
 * win + zip:
 *   1. Extract ZIP into a temp folder inside targetDir
 *   2. Delete the ZIP
 *   3. Rename temp folder → <installedPath>
 *   (Bruno.exe is found later by findExe when launching)
 */
async function extractAndInstall(downloadPath, installedPath, targetDir, osName, format) {
  if (osName === 'mac' && format === 'zip') {
    console.log(`Extracting ${downloadPath} to ${targetDir}...`);
    await extract(downloadPath, { dir: targetDir });

    const foundAppPath = await findApp(targetDir);
    if (!foundAppPath) {
      const contents = await fs.readdir(targetDir);
      throw new Error(`Bruno.app not found after extraction. Contents: ${contents.join(', ')}`);
    }

    console.log(`Deleting ZIP: ${downloadPath}`);
    await fs.unlink(downloadPath);

    console.log(`Renaming: ${foundAppPath} → ${installedPath}`);
    await fs.rename(foundAppPath, installedPath);

  } else if (osName === 'mac' && format === 'dmg') {
    const mountPoint = path.join(os.tmpdir(), `bruget-mount-${Date.now()}`);
    await fs.mkdir(mountPoint, { recursive: true });
    console.log(`Mounting DMG at ${mountPoint}...`);
    await execAsync(`hdiutil attach "${downloadPath}" -mountpoint "${mountPoint}" -nobrowse -quiet`);

    try {
      const foundAppPath = await findApp(mountPoint);
      if (!foundAppPath) {
        const contents = await fs.readdir(mountPoint);
        throw new Error(`Bruno.app not found in DMG. Contents: ${contents.join(', ')}`);
      }
      console.log(`Copying Bruno.app → ${installedPath}...`);
      await execAsync(`cp -R "${foundAppPath}" "${installedPath}"`);
    } finally {
      // Always detach — even if copy failed — to avoid leaving ghost mounts
      console.log('Detaching DMG...');
      await execAsync(`hdiutil detach "${mountPoint}" -quiet`).catch(() => {});
      await fs.rmdir(mountPoint).catch(() => {});
    }

    console.log(`Deleting DMG: ${downloadPath}`);
    await fs.unlink(downloadPath);

  } else if (osName === 'linux' && format === 'AppImage') {
    console.log(`Installing AppImage to ${installedPath}...`);
    // Rename first, then chmod — the versioned name is the final artifact
    await fs.rename(downloadPath, installedPath);
    await fs.chmod(installedPath, 0o755);

  } else if (osName === 'win' && format === 'zip') {
    // Extract to a temp dir first to avoid polluting targetDir if extraction fails
    const extractTempDir = path.join(targetDir, `_extract_${Date.now()}`);
    console.log(`Extracting ${downloadPath} to ${extractTempDir}...`);
    await extract(downloadPath, { dir: extractTempDir });

    console.log(`Deleting ZIP: ${downloadPath}`);
    await fs.unlink(downloadPath);

    console.log(`Moving to: ${installedPath}`);
    await fs.rename(extractTempDir, installedPath);

  } else {
    throw new Error(`Unsupported format "${format}" for platform "${osName}"`);
  }
}

/**
 * Downloads and installs a specific Bruno stable release version.
 *
 * If the versioned app already exists, skips download/install and opens it directly.
 * If the download file already exists (e.g. from a previous interrupted run), skips download.
 *
 * @param {string} version  - Semver string, e.g. "2.15.0"
 * @param {string} targetDir - Directory where Bruno versions are stored
 */
async function installVersion(version, targetDir) {
  const { os: osName, arch, stableFormat } = getPlatformInfo();

  console.log();
  console.log('======================================================');
  console.log(`Installing Bruno v${version}`);
  console.log(`Platform: ${osName} (${arch})`);
  console.log(`Target dir: ${targetDir}`);
  console.log('------------------------------------------------------');

  await fs.mkdir(targetDir, { recursive: true });

  // Construct GitHub release asset filename and URL
  const filename = `bruno_${version}_${arch}_${osName}.${stableFormat}`;
  const url = `https://github.com/usebruno/bruno/releases/download/v${version}/${filename}`;
  const downloadPath = path.join(targetDir, filename);
  const installedPath = getInstalledPath(targetDir, `Bruno-${version}`, osName);

  // Skip everything if this version is already installed
  try {
    await fs.access(installedPath);
    console.log(`Bruno-${version} already exists at:`);
    console.log(`  ${installedPath}`);
    console.log('Opening existing app...');
    await openApp(installedPath, osName);
    return;
  } catch {}

  // Skip download if the asset file was already downloaded (e.g. previous interrupted run)
  try {
    await fs.access(downloadPath);
    console.log(`Already downloaded: ${downloadPath}`);
  } catch {
    console.log(`Downloading ${filename}...`);
    console.log(`  from: ${url}`);
    await downloadFile(url, downloadPath);
  }

  await extractAndInstall(downloadPath, installedPath, targetDir, osName, stableFormat);

  console.log(`Installed Bruno-${version} at:`);
  console.log(`  ${installedPath}`);
  console.log(`Opening Bruno-${version}...`);
  await openApp(installedPath, osName);
}

/**
 * Queries the GitHub API for a nightly release by date or fetches the latest.
 *
 * Nightly tag format: v<semver>-<yyyy.mm.dd>  e.g. v3.2.2-2026.04.13
 * The date param uses dashes (yyyy-mm-dd) but the tag uses dots (yyyy.mm.dd),
 * so we replace before searching.
 *
 * @param {string} dateOrLatest - 'latest' or a date string in yyyy-mm-dd format
 * @returns {object} GitHub release object
 */
async function fetchNightlyRelease(dateOrLatest) {
  const headers = { 'User-Agent': 'bruget-cli' };

  if (dateOrLatest === 'latest') {
    console.log('Fetching latest nightly release info...');
    const res = await fetch(`${GITHUB_API}/repos/${NIGHTLY_REPO}/releases/latest`, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Convert yyyy-mm-dd → yyyy.mm.dd to match tag format (e.g. v3.2.2-2026.04.13)
  const dotDate = dateOrLatest.replace(/-/g, '.');
  console.log(`Fetching nightly release for ${dotDate}...`);
  const res = await fetch(`${GITHUB_API}/repos/${NIGHTLY_REPO}/releases?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  const releases = await res.json();
  const release = releases.find(r => r.tag_name.includes(dotDate));
  if (!release) throw new Error(`No nightly release found for date: ${dateOrLatest}`);
  return release;
}

/**
 * Downloads and installs a Bruno nightly build.
 *
 * Nightly builds come from usebruno/bruno-nightly-builds. Tags follow the format
 * v<semver>-<yyyy.mm.dd> (e.g. v3.2.2-2026.04.13). Both the semver and date are
 * extracted from the tag to construct the asset filename.
 *
 * macOS nightly uses a DMG (not ZIP like stable), so it goes through hdiutil mount/copy.
 * Linux and Windows nightly use the same formats as stable (AppImage and ZIP).
 *
 * @param {string} dateOrLatest - 'latest' or a date string in yyyy-mm-dd format
 * @param {string} targetDir    - Directory where Bruno versions are stored
 */
async function installNightlyVersion(dateOrLatest, targetDir) {
  const { os: osName, arch, nightlyFormat } = getPlatformInfo();

  console.log();
  console.log('======================================================');
  console.log(`Installing Bruno Nightly: ${dateOrLatest}`);
  console.log(`Platform: ${osName} (${arch})`);
  console.log(`Target dir: ${targetDir}`);
  console.log('------------------------------------------------------');

  await fs.mkdir(targetDir, { recursive: true });

  const release = await fetchNightlyRelease(dateOrLatest);
  const tagName = release.tag_name; // e.g. v3.2.2-2026.04.13
  console.log(`Found release: ${tagName}`);

  // Parse semver and dot-date from tag (needed to construct the asset filename)
  const match = tagName.match(/^v(\d+\.\d+\.\d+)-(\d{4}\.\d{2}\.\d{2})$/);
  if (!match) throw new Error(`Unexpected tag format: ${tagName}`);
  const [, version, dotDate] = match;

  const filename = `bruno_${version}_${arch}_${osName}.${nightlyFormat}`;
  const url = `https://github.com/${NIGHTLY_REPO}/releases/download/${tagName}/${filename}`;
  const downloadPath = path.join(targetDir, filename);
  // Label uses dot-date (matching the tag) so installs from the same day are idempotent
  const appLabel = `Bruno-nightly-${dotDate}`;
  const installedPath = getInstalledPath(targetDir, appLabel, osName);

  // Skip everything if this nightly build is already installed
  try {
    await fs.access(installedPath);
    console.log(`${appLabel} already exists at:`);
    console.log(`  ${installedPath}`);
    console.log('Opening existing app...');
    await openApp(installedPath, osName);
    return;
  } catch {}

  console.log(`Downloading ${filename}...`);
  console.log(`  from: ${url}`);
  await downloadFile(url, downloadPath);
  console.log(`Downloaded to: ${downloadPath}`);

  await extractAndInstall(downloadPath, installedPath, targetDir, osName, nightlyFormat);

  console.log(`Installed ${appLabel} at:`);
  console.log(`  ${installedPath}`);
  console.log(`Opening ${appLabel}...`);
  await openApp(installedPath, osName);
}

module.exports = { installVersion, installNightlyVersion };
