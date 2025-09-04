const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(str){ return Uint8Array.from(atob(str), c=>c.charCodeAt(0)); }

// Default iteration count for PBKDF2. Expose this so future versions can
// increase the work factor without requiring data migration.
const DEFAULT_PBKDF2_ITERATIONS = 600_000;
// Derive an AES-GCM key from a passphrase using PBKDF2.  The iteration count
// is configurable and defaults to a high number to make brute-force attempts
// more expensive.
async function deriveKey(pass, saltBytes, iterations = DEFAULT_PBKDF2_ITERATIONS){
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: saltBytes, iterations, hash:'SHA-256' },
    baseKey,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}

// Encrypt an object for sharing using the supplied passphrase.  The returned
// payload includes the parameters necessary to re-derive the key in the
// future, allowing the cost factor to be tuned without breaking old data.
async function encryptForShare(obj, pass, iterations = DEFAULT_PBKDF2_ITERATIONS){
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, saltBytes, iterations);
  const data = enc.encode(JSON.stringify(obj));
  const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data);
  return { salt: b64(saltBytes), iv: b64(iv), data: b64(buf), iterations };
}

// Decrypt a payload created by encryptForShare.  If the payload specifies an
// iteration count use it, otherwise fall back to the current default.
async function decryptShared(encObj, pass){
  const saltBytes = b64ToBuf(encObj.salt);
  const iv = b64ToBuf(encObj.iv);
  const data = b64ToBuf(encObj.data);
  const iterations = encObj.iterations || DEFAULT_PBKDF2_ITERATIONS;
  const key = await deriveKey(pass, saltBytes, iterations);
  const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, data);
  return JSON.parse(dec.decode(new Uint8Array(buf)));
}

export { deriveKey, encryptForShare, decryptShared, DEFAULT_PBKDF2_ITERATIONS };
