import { getItems, getNotes, getMessages } from './features.js';

async function startCollaboration(sessionId, secret, saltBytes) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(sessionId + secret));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  const channel = new BroadcastChannel(`tl-collab-${hashHex}`);
  let salt = saltBytes ? new Uint8Array(saltBytes) : null;
  let keyPromise = null;
  let handshakeComplete = false;

  function showSalt() {
    if (!salt) return;
    const hex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log('Collaboration salt:', hex);
  }

  async function getKey() {
    if (!secret) throw new Error('secret-required');
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      channel.postMessage({ salt: Array.from(salt) });
      showSalt();
    }
    if (!keyPromise) {
      const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      keyPromise = crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }
    return keyPromise;
  }

  async function encryptPayload(payload) {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify(payload))
    );
    return { cipher: Array.from(new Uint8Array(encrypted)), iv: Array.from(iv) };
  }

  async function sendHandshake() {
    channel.postMessage(await encryptPayload({ type: 'handshake' }));
  }

  channel.onmessage = async e => {
    try {
      if (e.data && e.data.salt && !salt) {
        salt = new Uint8Array(e.data.salt);
        showSalt();
        await getKey();
        await sendHandshake();
        return;
      }
      const { cipher, iv } = e.data || {};
      if (!cipher || !iv) return;
      const key = await getKey();
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        new Uint8Array(cipher)
      );
      const data = JSON.parse(decoder.decode(decrypted));
      if (data && data.type === 'handshake') {
        const wasComplete = handshakeComplete;
        handshakeComplete = true;
        if (!wasComplete) await sendHandshake();
        return;
      }
      if (!handshakeComplete) return;
      if (data && data.items && data.notes) {
        if (typeof saveItems === 'function') saveItems(data.items);
        if (typeof saveNotes === 'function') saveNotes(data.notes);
        if (typeof saveMessages === 'function') saveMessages(data.messages || []);
        if (typeof rescheduleAllNotifications === 'function') rescheduleAllNotifications();
      }
    } catch (err) {
      // ignore invalid messages
    }
  };

  async function broadcast() {
    if (!handshakeComplete) {
      await sendHandshake();
      return;
    }
    channel.postMessage(await encryptPayload({ items: getItems(), notes: getNotes(), messages: getMessages() }));
  }

  return { channel, broadcast, getSalt: () => Array.from(salt || []) };
}

export { startCollaboration };
