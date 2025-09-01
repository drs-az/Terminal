const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Files to include in the asset manifest
const files = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'features.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

const root = __dirname;

function createManifest() {
  const hash = crypto.createHash('sha256');

  for (const file of files) {
    const filePath = path.join(root, file);
    const data = fs.readFileSync(filePath);
    hash.update(data);
  }

  const version = hash.digest('hex').slice(0, 8);
  const manifest = {
    version,
    files: ['./', ...files.map(f => './' + f)]
  };

  const content = `self.__ASSET_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`;
  fs.writeFileSync(path.join(root, 'asset-manifest.js'), content);
  console.log(`Generated asset-manifest.js with version ${version}`);
}

createManifest();
