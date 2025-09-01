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
  'icons/icon-512.png',
  'config.json'
];

const root = __dirname;

function createManifest() {
  const hash = crypto.createHash('sha256');

  // Write config.json from environment variables
  const config = {
    clientId: process.env.GDRIVE_CLIENT_ID || '',
    apiKey: process.env.GDRIVE_API_KEY || ''
  };
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 2));

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
  console.log('Wrote config.json');
}

createManifest();
