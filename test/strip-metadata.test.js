const assert = require('assert');

(async () => {
  const stripImageMetadata = (await import('../third_party/strip-metadata.js')).default;

  const bufWithExif = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x00,
    0x00,
    0xff, 0xd9
  ]);

  assert(bufWithExif.indexOf('Exif') !== -1, 'Original should contain Exif');

  const blob = new Blob([bufWithExif], { type: 'image/jpeg' });
  const cleaned = await stripImageMetadata(blob);
  const cleanedBuf = Buffer.from(await cleaned.arrayBuffer());

  assert.strictEqual(cleanedBuf.indexOf('Exif'), -1, 'Exif should be stripped');
  // Ensure JPEG markers remain
  assert(cleanedBuf[0] === 0xff && cleanedBuf[1] === 0xd8, 'JPEG SOI preserved');
  assert(cleanedBuf[cleanedBuf.length - 2] === 0xff && cleanedBuf[cleanedBuf.length - 1] === 0xd9, 'JPEG EOI preserved');
  console.log('Metadata stripping test passed.');
})();
