// Packages chrome-extension/ into public/downloads/nexaris-connect-extension.zip
// -- the file ImportSessionModal.tsx links the client to download. Runs on
// every `npm run build` (see package.json's "prebuild") so the zip can
// never silently drift out of sync with the extension's actual source --
// a hand-maintained zip that isn't rebuilt when popup.js/manifest.json
// change would ship a stale extension with no warning.
//
// LIVE-CONFIRMED 2026-08-31: a hand-rolled zip writer (raw DEFLATE +
// manually-built local/central-directory headers, no new dependency) was
// tried first here to avoid adding a library for one file. It produced a
// structurally valid zip -- verified independently via Python's zipfile
// module AND PowerShell's Expand-Archive, both extracted it cleanly -- but
// Windows' own "Compressed Folders" shell viewer (a separate, notoriously
// picky legacy implementation from either of those) rejected it outright
// with "Cannot open" for a real client, with no diagnosable-from-outside
// reason. Since that's the exact tool most non-technical Windows users
// will actually double-click, "technically spec-compliant" wasn't good
// enough -- archiver is a small, battle-tested library used by millions
// of projects specifically for this, worth the one dependency to remove
// all doubt about compatibility with every real zip tool a client might use.
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZipArchive } from "archiver";

const SRC_DIR = join(import.meta.dirname, "..", "chrome-extension");
const OUT_DIR = join(import.meta.dirname, "..", "public", "downloads");
const OUT_FILE = join(OUT_DIR, "nexaris-connect-extension.zip");

mkdirSync(OUT_DIR, { recursive: true });

const output = createWriteStream(OUT_FILE);
// v8's API dropped the archiver("zip", opts) factory function most online
// examples reference -- ZipArchive is the real exported class now (see
// node_modules/archiver/index.js).
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on("close", () => {
  console.log(`Built ${OUT_FILE} (${archive.pointer()} bytes)`);
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(SRC_DIR, false);
await archive.finalize();
