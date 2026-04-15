const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');
const extract = require('extract-zip');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const NIGHTLY_REPO = 'usebruno/bruno-nightly-builds';
const GITHUB_API = 'https://api.github.com';

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

async function installVersion(version, arch, targetDir) {
  console.log();
  console.log('======================================================');
  console.log(`Installing Bruno v${version}`);
  console.log(`Architecture: ${arch}`);
  console.log(`Target dir: ${targetDir}`);
  console.log('------------------------------------------------------');

  await fs.mkdir(targetDir, { recursive: true });

  const filename = `bruno_${version}_${arch}_mac.zip`;
  const url = `https://github.com/usebruno/bruno/releases/download/v${version}/${filename}`;
  const zipPath = path.join(targetDir, filename);
  const versionedAppPath = path.join(targetDir, `Bruno-${version}.app`);

  // Check if already exists
  try {
    await fs.access(versionedAppPath);
    console.log(`Bruno-${version}.app already exists at:`);
    console.log(`  ${versionedAppPath}`);
    console.log('Opening existing app...');
    await execAsync(`open "${versionedAppPath}"`).catch(() => {});
    return;
  } catch {
    // Doesn't exist, continue
  }

  // Download if needed
  try {
    await fs.access(zipPath);
    console.log(`ZIP already downloaded: ${zipPath}`);
  } catch {
    console.log(`Downloading ${filename}...`);
    console.log(`  from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.statusText}. Check that the release/asset exists.`
      );
    }
    const buffer = await response.buffer();
    await fs.writeFile(zipPath, buffer);
  }

  // Extract
  console.log(`Extracting ${zipPath} to ${targetDir}...`);
  await extract(zipPath, { dir: targetDir });

  // Find Bruno.app
  const foundAppPath = await findApp(targetDir);
  if (!foundAppPath) {
    const contents = await fs.readdir(targetDir);
    throw new Error(
      `Bruno.app not found after extraction. Contents: ${contents.join(', ')}`
    );
  }

  // Delete ZIP
  console.log(`Deleting ZIP: ${zipPath}`);
  await fs.unlink(zipPath);

  // Rename
  console.log('Renaming extracted app:');
  console.log(`  ${foundAppPath} → ${versionedAppPath}`);
  await fs.rename(foundAppPath, versionedAppPath);

  console.log(`Installed Bruno-${version} at:`);
  console.log(`  ${versionedAppPath}`);

  // Open
  console.log(`Opening Bruno-${version}.app...`);
  await execAsync(`open "${versionedAppPath}"`).catch(() => {});
}

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

async function installNightlyVersion(dateOrLatest, arch, targetDir) {
  console.log();
  console.log('======================================================');
  console.log(`Installing Bruno Nightly: ${dateOrLatest}`);
  console.log(`Architecture: ${arch}`);
  console.log(`Target dir: ${targetDir}`);
  console.log('------------------------------------------------------');

  await fs.mkdir(targetDir, { recursive: true });

  const release = await fetchNightlyRelease(dateOrLatest);
  const tagName = release.tag_name; // e.g. v3.2.2-2026.04.13
  console.log(`Found release: ${tagName}`);

  // Parse version and date from tag
  const match = tagName.match(/^v(\d+\.\d+\.\d+)-(\d{4}\.\d{2}\.\d{2})$/);
  if (!match) throw new Error(`Unexpected tag format: ${tagName}`);
  const [, version, dotDate] = match;

  const filename = `bruno_${version}_${arch}_mac.dmg`;
  const url = `https://github.com/${NIGHTLY_REPO}/releases/download/${tagName}/${filename}`;
  const dmgPath = path.join(targetDir, filename);
  const appName = `Bruno-nightly-${dotDate}.app`;
  const versionedAppPath = path.join(targetDir, appName);

  // Check if already installed
  try {
    await fs.access(versionedAppPath);
    console.log(`${appName} already exists at:`);
    console.log(`  ${versionedAppPath}`);
    console.log('Opening existing app...');
    await execAsync(`open "${versionedAppPath}"`).catch(() => {});
    return;
  } catch {
    // Continue
  }

  // Download DMG
  console.log(`Downloading ${filename}...`);
  console.log(`  from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}. Check that the release/asset exists.`);
  }
  const buffer = await response.buffer();
  await fs.writeFile(dmgPath, buffer);
  console.log(`Downloaded to: ${dmgPath}`);

  // Mount DMG
  const mountPoint = path.join(os.tmpdir(), `bruget-mount-${Date.now()}`);
  await fs.mkdir(mountPoint, { recursive: true });
  console.log(`Mounting DMG at ${mountPoint}...`);
  await execAsync(`hdiutil attach "${dmgPath}" -mountpoint "${mountPoint}" -nobrowse -quiet`);

  try {
    const foundAppPath = await findApp(mountPoint);
    if (!foundAppPath) {
      const contents = await fs.readdir(mountPoint);
      throw new Error(`Bruno.app not found in DMG. Contents: ${contents.join(', ')}`);
    }

    // Copy app out of the mounted volume
    console.log(`Copying Bruno.app → ${versionedAppPath}...`);
    await execAsync(`cp -R "${foundAppPath}" "${versionedAppPath}"`);
  } finally {
    console.log('Detaching DMG...');
    await execAsync(`hdiutil detach "${mountPoint}" -quiet`).catch(() => {});
    await fs.rmdir(mountPoint).catch(() => {});
  }

  // Delete DMG
  console.log(`Deleting DMG: ${dmgPath}`);
  await fs.unlink(dmgPath);

  console.log(`Installed ${appName} at:`);
  console.log(`  ${versionedAppPath}`);

  // Open
  console.log(`Opening ${appName}...`);
  await execAsync(`open "${versionedAppPath}"`).catch(() => {});
}

module.exports = { installVersion, installNightlyVersion };
