/**
 * Minimal ZIP Reader — Zero-dependency ZIP extraction for .nv-world.zip files
 *
 * Parses ZIP archives using only Node built-ins (zlib for deflate).
 * Supports STORE (method 0) and DEFLATE (method 8) compression.
 *
 * This is intentionally minimal — it handles the specific case of reading
 * small JSON/text files from a governance world archive. It does not support
 * ZIP64, encryption, multi-disk archives, or other advanced features.
 */

import { inflateRawSync } from 'zlib';

export interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  offset: number; // local file header offset
}

/**
 * Read all files from a ZIP buffer.
 * Returns a Map of filename → content (as UTF-8 string).
 */
export function readZipEntries(buf: Buffer): Map<string, string> {
  const entries = parseCentralDirectory(buf);
  const result = new Map<string, string>();

  for (const entry of entries) {
    // Skip directories
    if (entry.filename.endsWith('/')) continue;

    const content = extractEntry(buf, entry);
    result.set(entry.filename, content);
  }

  return result;
}

/**
 * Parse the ZIP central directory to find all file entries.
 */
function parseCentralDirectory(buf: Buffer): ZipEntry[] {
  // Find End of Central Directory record (EOCD)
  // Signature: 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP file: End of Central Directory record not found');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let offset = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    // Central directory file header signature: 0x02014b50
    if (
      buf[offset] !== 0x50 ||
      buf[offset + 1] !== 0x4b ||
      buf[offset + 2] !== 0x01 ||
      buf[offset + 3] !== 0x02
    ) {
      throw new Error(`Invalid ZIP central directory entry at offset ${offset}`);
    }

    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraFieldLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);

    const filename = buf.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf-8');

    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      offset: localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

/**
 * Extract a single entry's content as a UTF-8 string.
 */
function extractEntry(buf: Buffer, entry: ZipEntry): string {
  const localOffset = entry.offset;

  // Local file header signature: 0x04034b50
  if (
    buf[localOffset] !== 0x50 ||
    buf[localOffset + 1] !== 0x4b ||
    buf[localOffset + 2] !== 0x03 ||
    buf[localOffset + 3] !== 0x04
  ) {
    throw new Error(`Invalid local file header for ${entry.filename}`);
  }

  const localFileNameLength = buf.readUInt16LE(localOffset + 26);
  const localExtraLength = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localFileNameLength + localExtraLength;
  const compressedData = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // STORE — no compression
    return compressedData.toString('utf-8');
  }

  if (entry.compressionMethod === 8) {
    // DEFLATE
    const decompressed = inflateRawSync(compressedData);
    return decompressed.toString('utf-8');
  }

  throw new Error(
    `Unsupported compression method ${entry.compressionMethod} for ${entry.filename}`
  );
}
