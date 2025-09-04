const fs = require('fs');
const content = fs.readFileSync('sw.js', 'utf8');
if (content.includes('Cache-Control') && content.includes('no-store')) {
  console.log('Cache-Control no-store header found in service worker.');
} else {
  console.error('Cache-Control no-store header missing in service worker.');
  process.exit(1);
}
