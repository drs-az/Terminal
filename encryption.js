const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(str){ return Uint8Array.from(atob(str), c=>c.charCodeAt(0)); }

// Default scrypt parameters. Exposed so future versions can tune the work
// factor without requiring data migration.
const DEFAULT_SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };
// Derive an AES-GCM key from a passphrase using scrypt. The parameters are
// stored alongside the encrypted payload so the cost can be adjusted over time.
async function deriveKey(pass, saltBytes, params = DEFAULT_SCRYPT_PARAMS){
  const { scrypt } = await import('./scrypt.js');
  const passBytes = enc.encode(pass);
  const dk = await scrypt(passBytes, saltBytes, { ...params, dkLen: 32 });
  return crypto.subtle.importKey('raw', dk, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
}

// Encrypt an object for sharing using the supplied passphrase.  The returned
// payload includes the parameters necessary to re-derive the key in the
// future, allowing the cost factor to be tuned without breaking old data.
async function encryptForShare(obj, pass, params = DEFAULT_SCRYPT_PARAMS){
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, saltBytes, params);
  const data = enc.encode(JSON.stringify(obj));
  const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data);
  return { salt: b64(saltBytes), iv: b64(iv), data: b64(buf), kdf: { name:'scrypt', ...params } };
}

// Decrypt a payload created by encryptForShare.  If the payload specifies
// scrypt parameters use them, otherwise fall back to the current defaults.
async function decryptShared(encObj, pass){
  const saltBytes = b64ToBuf(encObj.salt);
  const iv = b64ToBuf(encObj.iv);
  const data = b64ToBuf(encObj.data);
  const params = (encObj.kdf && encObj.kdf.name === 'scrypt')
    ? { N: encObj.kdf.N, r: encObj.kdf.r, p: encObj.kdf.p }
    : DEFAULT_SCRYPT_PARAMS;
  const key = await deriveKey(pass, saltBytes, params);
  const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, data);
  return JSON.parse(dec.decode(new Uint8Array(buf)));
}

export { deriveKey, encryptForShare, decryptShared, DEFAULT_SCRYPT_PARAMS };
