// Packages chrome-extension/ into public/downloads/nexaris-connect-extension.zip
// -- the file ImportSessionModal.tsx links the client to download. Runs on
// every `npm run build` (see package.json's "prebuild") so the zip can
// never silently drift out of sync with the extension's actual source --
// a hand-maintained zip that isn't rebuilt when popup.js/manifest.json
// change would ship a stale extension with no warning.
//
// Written against Node's built-in zlib (raw DEFLATE, no CRC/zip-format
// library needed) rather than adding a new npm dependency (archiver,
// adm-zip, etc.) just for one file -- and deliberately NOT PowerShell's
// Compress-Archive, which doesn't exist on Vercel's Linux build machines
// (this script runs there on every real deploy, not just locally).
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

const SRC_DIR = join(import.meta.dirname, "..", "chrome-extension");
const OUT_DIR = join(import.meta.dirname, "..", "public", "downloads");
const OUT_FILE = join(OUT_DIR, "nexaris-connect-extension.zip");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return ~c >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function collectFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, base));
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = collectFiles(SRC_DIR).map((full) => ({
  full,
  name: relative(SRC_DIR, full).replace(/\\/g, "/"),
}));

const localParts = [];
const centralParts = [];
let offset = 0;

for (const { full, name } of files) {
  const content = readFileSync(full);
  const compressed = deflateRawSync(content);
  const crc = crc32(content);
  const { time, day } = dosDateTime(statSync(full).mtime);
  const nameBuf = Buffer.from(name, "utf-8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // method: deflate
  localHeader.writeUInt16LE(time, 10);
  localHeader.writeUInt16LE(day, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra field length

  localParts.push(localHeader, nameBuf, compressed);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(8, 10); // method: deflate
  centralHeader.writeUInt16LE(time, 12);
  centralHeader.writeUInt16LE(day, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra field length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number start
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(offset, 42); // local header offset

  centralParts.push(centralHeader, nameBuf);

  offset += localHeader.length + nameBuf.length + compressed.length;
}

const centralDirStart = offset;
const centralDir = Buffer.concat(centralParts);

const endRecord = Buffer.alloc(22);
endRecord.writeUInt32LE(0x06054b50, 0);
endRecord.writeUInt16LE(0, 4); // disk number
endRecord.writeUInt16LE(0, 6); // disk with central dir
endRecord.writeUInt16LE(files.length, 8); // entries this disk
endRecord.writeUInt16LE(files.length, 10); // total entries
endRecord.writeUInt32LE(centralDir.length, 12); // central dir size
endRecord.writeUInt32LE(centralDirStart, 16); // central dir offset
endRecord.writeUInt16LE(0, 20); // comment length

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, Buffer.concat([...localParts, centralDir, endRecord]));

console.log(`Built ${OUT_FILE} (${files.length} files)`);
