// Magic-byte sniffing: the declared type and extension of an upload must match
// what the bytes actually are.
const SIGS: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  doc: [[0xd0, 0xcf, 0x11, 0xe0]],
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
  zip: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]],
};

export function matchesExtension(ext: string, head: Uint8Array): boolean {
  const sigs = SIGS[ext];
  return !!sigs && sigs.some((sig) => sig.every((b, i) => head[i] === b));
}

/** Keeps a display-safe file name (no paths, control chars or odd unicode). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.normalize('NFC').replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(-120);
}
