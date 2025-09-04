export default async function stripImageMetadata(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // Ensure JPEG SOI
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return file;
  const segments = [];
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) break;
    const marker = buf[pos + 1];
    if (marker === 0xda) { // Start of Scan
      segments.push(buf.subarray(pos));
      break;
    }
    const len = (buf[pos + 2] << 8) | buf[pos + 3];
    const segmentEnd = pos + 4 + len;
    const isExif = marker === 0xe1 &&
      buf[pos + 4] === 0x45 &&
      buf[pos + 5] === 0x78 &&
      buf[pos + 6] === 0x69 &&
      buf[pos + 7] === 0x66;
    if (!isExif) {
      segments.push(buf.subarray(pos, segmentEnd));
    }
    pos = segmentEnd;
  }
  const size = 2 + segments.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(size);
  out[0] = 0xff; out[1] = 0xd8;
  let offset = 2;
  for (const seg of segments) {
    out.set(seg, offset);
    offset += seg.length;
  }
  return new Blob([out], { type: file.type });
}
