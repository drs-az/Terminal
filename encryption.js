const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(str){ return Uint8Array.from(atob(str), c=>c.charCodeAt(0)); }

async function deriveKey(pass, saltBytes){
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: saltBytes, iterations:200000, hash:'SHA-256' },
    baseKey,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}

async function encryptForShare(obj, pass){
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, saltBytes);
  const data = enc.encode(JSON.stringify(obj));
  const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data);
  return { salt: b64(saltBytes), iv: b64(iv), data: b64(buf) };
}

async function decryptShared(encObj, pass){
  const saltBytes = b64ToBuf(encObj.salt);
  const iv = b64ToBuf(encObj.iv);
  const data = b64ToBuf(encObj.data);
  const key = await deriveKey(pass, saltBytes);
  const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, data);
  return JSON.parse(dec.decode(new Uint8Array(buf)));
}

export { deriveKey, encryptForShare, decryptShared };
