const assert = require('assert');
require('../sanitize.js');

let called = false;
global.DOMPurify = {
  sanitize(input) {
    called = true;
    return input.replace(/onerror\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '');
  }
};

const malicious = '<img src=x onerror=alert(1)>';
const sanitized = sanitizeHTML(malicious);

if (!called) {
  console.error('DOMPurify.sanitize was not invoked.');
  process.exit(1);
}

if (/onerror/i.test(sanitized)) {
  console.error('Malicious HTML was not sanitized.');
  process.exit(1);
}

console.log('Malicious HTML was sanitized.');
