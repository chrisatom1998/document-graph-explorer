/**
 * Inspects the first bytes of a file to determine if it contains clean
 * readable text (UTF-8 or ASCII) vs binary data. Used as a fallback for
 * files with unknown extensions so they can be ingested as plain text
 * rather than silently ignored.
 */

/** Maximum bytes to inspect for text detection. */
const SNIFF_SIZE = 8192;

/** Binary file signatures to reject immediately. */
const BINARY_SIGNATURES: [number[], string][] = [
  [[0x7f, 0x45, 0x4c, 0x46], 'ELF'],           // ELF executables
  [[0x4d, 0x5a], 'PE'],                         // Windows PE
  [[0xfe, 0xed, 0xfa], 'Mach-O'],               // macOS Mach-O
  [[0xcf, 0xfa, 0xed, 0xfe], 'Mach-O'],         // macOS Mach-O (reversed)
  [[0xca, 0xfe, 0xba, 0xbe], 'Mach-O universal'], // Universal binary
  [[0x50, 0x4b, 0x03, 0x04], 'ZIP'],            // ZIP/JAR/APK
  [[0x50, 0x4b, 0x05, 0x06], 'ZIP'],            // ZIP empty archive
  [[0x1f, 0x8b], 'gzip'],                       // gzip
  [[0x42, 0x5a, 0x68], 'bzip2'],                // bzip2
  [[0xfd, 0x37, 0x7a, 0x58, 0x5a], 'xz'],       // xz
  [[0x89, 0x50, 0x4e, 0x47], 'PNG'],            // PNG
  [[0xff, 0xd8, 0xff], 'JPEG'],                 // JPEG
  [[0x47, 0x49, 0x46, 0x38], 'GIF'],            // GIF
  [[0x52, 0x49, 0x46, 0x46], 'RIFF'],           // WAV/AVI/WebP
  [[0x00, 0x00, 0x00], 'likely binary'],         // MP4/MOV/many binary formats
  [[0x25, 0x50, 0x44, 0x46], 'PDF'],            // PDF (shouldn't reach here but safety)
  [[0xd0, 0xcf, 0x11, 0xe0], 'OLE2'],           // Old Office formats (.doc, .xls, .ppt)
];

/**
 * Returns true if the buffer appears to contain readable text content.
 * Inspects up to SNIFF_SIZE bytes for binary signatures and non-text
 * byte patterns.
 */
export function looksLikeText(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, SNIFF_SIZE));
  if (view.length === 0) return false;

  // Check binary signatures
  for (const [sig] of BINARY_SIGNATURES) {
    if (sig.length <= view.length && sig.every((b, i) => view[i] === b)) {
      return false;
    }
  }

  // Skip BOM if present
  let start = 0;
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) start = 3; // UTF-8 BOM
  if (view[0] === 0xfe && view[1] === 0xff) return false; // UTF-16 BE
  if (view[0] === 0xff && view[1] === 0xfe) return false; // UTF-16 LE

  // Count null bytes and other non-text bytes
  let nullCount = 0;
  let controlCount = 0;
  const checked = view.length - start;
  
  for (let i = start; i < view.length; i++) {
    const b = view[i];
    if (b === 0x00) {
      nullCount++;
      // More than 1% null bytes = binary
      if (nullCount > checked * 0.01) return false;
    } else if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      controlCount++;
      // More than 5% control chars = binary
      if (controlCount > checked * 0.05) return false;
    }
  }

  return true;
}
