#!/usr/bin/env node

/**
 * bruget CLI entry point.
 *
 * Commands:
 *   install <version> [versions...]     Install one or more stable Bruno versions
 *   install --nightly <yyyy-mm-dd|latest>  Install a nightly Bruno build by date
 *   clean                               Delete leftover ZIP/DMG files from failed installs
 *
 * All install logic lives in lib/installer.js. This file handles only argument
 * parsing, validation, and routing to the appropriate installer function.
 *
 * Install directory: ~/Downloads/bet-temp/bruno-versions/
 * Supports: macOS (arm64/x64), Linux (x64/arm64), Windows (x64/arm64)
 */

const { installVersion, installNightlyVersion } = require('../lib/installer');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const command = process.argv[2];
const args = process.argv.slice(3);

// All Bruno versions land in ~/Downloads/bet-temp/bruno-versions/ on every platform
const targetDir = path.join(os.homedir(), 'Downloads', 'bet-temp', 'bruno-versions');

function usage() {
  console.log('Usage:');
  console.log('  bruget install <version> [<version> ...]');
  console.log('  bruget install --nightly <yyyy-mm-dd|latest>');
  console.log('  bruget clean');
  console.log('');
  console.log('Examples:');
  console.log('  bruget install 2.15.0 2.14.0');
  console.log('  bruget install --nightly 2026-04-13');
  console.log('  bruget install --nightly latest');
  process.exit(1);
}

if (command === 'clean') {
  /**
   * Deletes leftover ZIP and DMG files from the versions directory.
   * These accumulate when a download completes but extraction fails (interrupted run).
   * Installed apps (.app bundles, .AppImage, extracted folders) are not touched.
   */
  (async () => {
    let files;
    try {
      files = await fs.readdir(targetDir);
    } catch {
      console.log('No versions directory found, nothing to clean.');
      process.exit(0);
    }
    const toDelete = files.filter(f => f.endsWith('.zip') || f.endsWith('.dmg'));
    if (toDelete.length === 0) {
      console.log('No ZIP or DMG files found.');
      process.exit(0);
    }
    for (const file of toDelete) {
      const filePath = path.join(targetDir, file);
      await fs.unlink(filePath);
      console.log(`Deleted: ${filePath}`);
    }
    console.log(`Cleaned ${toDelete.length} file(s).`);
    process.exit(0);
  })();

} else if (command === 'install') {
  const nightlyIdx = args.indexOf('--nightly');

  if (nightlyIdx !== -1) {
    /**
     * Nightly install path.
     * Expects a date in yyyy-mm-dd format or the literal string "latest".
     * The date is passed to fetchNightlyRelease() which searches GitHub releases
     * by converting it to the dot-separated format used in nightly tags (yyyy.mm.dd).
     */
    const dateOrLatest = args[nightlyIdx + 1];
    if (!dateOrLatest) {
      console.error('Please provide a date (yyyy-mm-dd) or "latest" after --nightly.');
      process.exit(1);
    }
    if (dateOrLatest !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(dateOrLatest)) {
      console.error('Date must be in yyyy-mm-dd format or "latest".');
      process.exit(1);
    }

    (async () => {
      try {
        await installNightlyVersion(dateOrLatest, targetDir);
        console.log('\nNightly install complete.');
      } catch (err) {
        console.error('Failed to install nightly:', err.message);
        process.exit(1);
      }
    })();

  } else {
    /**
     * Stable install path.
     * Accepts one or more semver strings. Installs them sequentially so progress
     * output stays readable. Each version is independent — one failure doesn't
     * abort the remaining installs (exitCode tracks overall success).
     */
    const versions = args;
    if (versions.length === 0) {
      console.error('Please provide at least one version (e.g. 2.15.0).');
      process.exit(1);
    }

    (async () => {
      let exitCode = 0;
      for (const version of versions) {
        try {
          await installVersion(version, targetDir);
        } catch (err) {
          console.error(`Failed to install version: ${version}`);
          console.error(err.message);
          exitCode = 1;
        }
      }
      console.log();
      if (exitCode === 0) {
        console.log('All requested versions processed.');
      } else {
        console.log('One or more installs failed (see messages above).');
      }
      process.exit(exitCode);
    })();
  }

} else {
  usage();
}
