// Generates public/downloads/install-nexaris-connect.bat -- a single
// Windows batch file the client double-clicks to install the Nexaris
// Connect Chrome extension, with NO zip/extract step at all.
//
// LIVE-CONFIRMED 2026-08-31: the zip-download approach (this file's
// predecessor, build-extension-zip.mjs) hit a real, unresolvable-in-the-
// moment client-side problem -- their "Extract All" produced an empty/
// partial folder (a corrupted download or a flaky extraction, never fully
// diagnosed over chat), and repeated re-download/re-extract attempts
// didn't fix it. The user asked directly for something simpler. A batch
// file the client double-clicks, which writes the extension's actual
// files directly onto their Desktop, removes the entire download-a-zip-
// then-extract-it-correctly step as a source of failure -- one file, one
// double-click, no folder-picker ambiguity about which extracted folder
// to select.
//
// An EARLIER version of this script embedded each file's raw text via a
// batch `(echo line1 & echo line2 & ...) > file` pattern. Abandoned before
// shipping: popup.js contains nested double quotes, template literals
// with embedded ${...} expressions, and other characters cmd.exe's
// quoting rules don't handle reliably line-by-line -- real risk of
// silently corrupting the JS in a way that's very hard to debug over
// chat with a non-technical user. Base64-encoding each file's full
// content and decoding it with `certutil -decode` (a real Windows-
// built-in tool, present on every Windows install, LIVE-VERIFIED via
// `certutil -decode` on this machine) sidesteps ALL of that -- base64
// text only ever contains [A-Za-z0-9+/=], nothing cmd.exe's parser can
// misinterpret.
//
// Embeds the CURRENT content of chrome-extension/{manifest.json,popup.html,
// popup.js} -- runs on every `npm run build` (see package.json's
// "prebuild") so this can never silently drift from the real extension
// source. No icons directory -- manifest.json's own "icons"/
// action.default_icon fields were removed (Chrome makes them optional; a
// generic puzzle-piece icon is a fine tradeoff against one more file to
// embed).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dirname, "..", "chrome-extension");
const OUT_DIR = join(import.meta.dirname, "..", "public", "downloads");
const OUT_FILE = join(OUT_DIR, "install-nexaris-connect.bat");

function b64(relativePath) {
  return readFileSync(join(SRC_DIR, relativePath)).toString("base64");
}

// certutil -decode expects base64 wrapped at a fixed line width (its own
// -encode output does this; a single unwrapped line is NOT guaranteed to
// decode correctly on every Windows version) -- 76 chars/line matches
// certutil's own convention.
//
// LIVE-VERIFIED 2026-08-31: every line inside a batch `( ... ) > file`
// block is run as its OWN COMMAND unless it starts with `echo` (or
// another real command) -- a bare base64 line with no `echo` prefix
// isn't redirected as text at all, it's executed as if it were a program
// name, which cmd.exe correctly reports as "not recognized" and simply
// skips, silently dropping that entire line's content from the output
// file. Confirmed by reproducing the exact failure this generator
// originally shipped with: only the two `echo`-prefixed marker lines
// made it into the .b64 file, every un-prefixed base64 line vanished,
// and certutil then "successfully" decoded an empty payload (0 bytes
// out) with no error -- explains why the resulting extension files were
// all 0 bytes. Every line written into the block below MUST be prefixed
// with `echo `.
function wrap(base64) {
  return base64
    .match(/.{1,76}/g)
    .map((line) => `echo ${line}`)
    .join("\r\n");
}

const files = {
  "manifest.json": b64("manifest.json"),
  "popup.html": b64("popup.html"),
  "popup.js": b64("popup.js"),
};

// LIVE-VERIFIED 2026-08-31: certutil -decode requires REAL PEM-style
// markers with a label between the dashes -- tried a shortened
// "-----BEGIN-----"/"-----END-----" (no label) first and it silently
// "succeeded" while producing garbage decoded bytes (confirmed via a
// known-good "Hello World!" round-trip that came out corrupted). The
// label content itself doesn't matter to certutil, but the marker
// FORMAT (dashes-BEGIN-space-LABEL-dashes) does.
const writeSteps = Object.entries(files)
  .map(
    ([name, base64]) => `(
echo -----BEGIN NEXARIS FILE-----
${wrap(base64)}
echo -----END NEXARIS FILE-----
) > "%TARGET%\\${name}.b64"
certutil -decode "%TARGET%\\${name}.b64" "%TARGET%\\${name}" >nul
del "%TARGET%\\${name}.b64"`
  )
  .join("\r\n\r\n");

const bat = `@echo off
REM Installs the Nexaris Connect Chrome extension directly to your Desktop.
REM Double-click this file, then follow the on-screen instructions.

set TARGET=%USERPROFILE%\\Desktop\\nexaris-connect-extension
mkdir "%TARGET%" 2>nul

${writeSteps}

echo.
echo Done! The Nexaris Connect extension has been placed on your Desktop
echo in a folder called "nexaris-connect-extension".
echo.
echo Next steps:
echo   1. Open Chrome and go to chrome://extensions
echo   2. Turn on "Developer mode" (top right)
echo   3. Click "Load unpacked"
echo   4. Select the "nexaris-connect-extension" folder on your Desktop
echo.
pause
`;

mkdirSync(OUT_DIR, { recursive: true });
// CRLF throughout -- this file is only ever run by cmd.exe on Windows
// (that's the whole point), and some Windows setups are picky about
// LF-only batch files.
writeFileSync(OUT_FILE, bat.replace(/\n/g, "\r\n"));

console.log(`Built ${OUT_FILE}`);
