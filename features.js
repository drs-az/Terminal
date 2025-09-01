/**
 * Feature helpers for Terminal List.
 * These implementations provide basic versions of the planned features
 * and interact with the global task/note state defined in index.html.
 */

// --- Recurring & Snoozeable Reminders ------------------------------------

const recurringTimers = new Map();

function msFromPattern(pattern = {}) {
  const every = pattern.every || 1;
  switch (pattern.unit) {
    case 'minute': return every * 60 * 1000;
    case 'hour': return every * 60 * 60 * 1000;
    case 'week': return every * 7 * 24 * 60 * 60 * 1000;
    case 'day':
    default: return every * 24 * 60 * 60 * 1000;
  }
}

function scheduleRecurringReminder(taskId, pattern) {
  const task = (window.items || []).find(t => t.id === taskId);
  if (!task) return;
  const interval = msFromPattern(pattern);
  const tick = () => {
    const next = new Date(Date.now() + interval);
    task.due = next.toISOString().slice(0, 10);
    if (typeof saveItems === 'function') saveItems(items);
    if (typeof scheduleTaskNotification === 'function') {
      scheduleTaskNotification(task);
    }
  };
  tick();
  const timer = setInterval(tick, interval);
  recurringTimers.set(taskId, timer);
}

function clearRecurringReminder(taskId) {
  const timer = recurringTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    recurringTimers.delete(taskId);
  }
}

function snoozeReminder(taskId, until) {
  const task = (window.items || []).find(t => t.id === taskId);
  if (!task) return;
  const date = new Date(until);
  if (isNaN(date)) return;
  task.due = date.toISOString().slice(0, 10);
  if (typeof saveItems === 'function') saveItems(items);
  if (typeof scheduleTaskNotification === 'function') {
    scheduleTaskNotification(task);
  }
}

// --- Advanced Tag & Search ------------------------------------------------

// Precomputed item index
const itemIndex = { tags: new Map(), pri: new Map(), done: new Map() };

function indexItems(items = window.items || []) {
  itemIndex.tags = new Map();
  itemIndex.pri = new Map();
  itemIndex.done = new Map();
  items.forEach(t => {
    const id = t.id;
    (t.tags || []).forEach(tag => {
      if (!itemIndex.tags.has(tag)) itemIndex.tags.set(tag, new Set());
      itemIndex.tags.get(tag).add(id);
    });
    const p = (t.pri || '').toUpperCase();
    if (p) {
      if (!itemIndex.pri.has(p)) itemIndex.pri.set(p, new Set());
      itemIndex.pri.get(p).add(id);
    }
    const doneKey = !!t.done;
    if (!itemIndex.done.has(doneKey)) itemIndex.done.set(doneKey, new Set());
    itemIndex.done.get(doneKey).add(id);
  });
  return itemIndex;
}

function intersectSets(a, b) {
  const res = new Set();
  a.forEach(v => { if (b.has(v)) res.add(v); });
  return res;
}

function parseAdvancedQuery(query) {
  if (!query) return [];
  const tokens = query.trim().split(/\s+/);
  const filters = { tags: [], text: [], due: null, done: null, pri: null };
  tokens.forEach(tok => {
    if (tok.startsWith('tag:')) filters.tags.push(tok.slice(4));
    else if (tok.startsWith('due:')) filters.due = tok.slice(4);
    else if (tok.startsWith('done:')) filters.done = tok.slice(5) === 'true';
    else if (tok.startsWith('pri:')) filters.pri = tok.slice(4).toUpperCase();
    else filters.text.push(tok.toLowerCase());
  });

  let ids = null;
  filters.tags.forEach(tag => {
    const set = itemIndex.tags.get(tag) || new Set();
    ids = ids ? intersectSets(ids, set) : new Set(set);
  });
  if (filters.pri) {
    const set = itemIndex.pri.get(filters.pri) || new Set();
    ids = ids ? intersectSets(ids, set) : new Set(set);
  }
  if (filters.done !== null) {
    const set = itemIndex.done.get(filters.done) || new Set();
    ids = ids ? intersectSets(ids, set) : new Set(set);
  }
  if (!ids) ids = new Set((window.items || []).map(t => t.id));

  const today = new Date().toISOString().slice(0, 10);
  const map = new Map((window.items || []).map(t => [t.id, t]));
  const result = [];
  ids.forEach(id => {
    const t = map.get(id);
    if (!t) return;
    if (filters.due) {
      if (filters.due === 'overdue') {
        if (!t.due || t.due >= today) return;
      } else {
        const due = filters.due === 'today' ? today : filters.due;
        if (t.due !== due) return;
      }
    }
    if (filters.text.length && !filters.text.every(q => t.text.toLowerCase().includes(q))) return;
    result.push(id);
  });
  return result;
}

// --- Rich Note Editing ----------------------------------------------------

function editNoteRich(noteId, options = {}) {
  const note = (window.notes || []).find(n => n.id === noteId);
  if (!note) return null;
  if (options.title !== undefined) note.title = options.title;
  if (options.body !== undefined) note.body = options.body;
  if (options.attachments !== undefined) note.attachments = options.attachments;
  if (options.links !== undefined) {
    note.links = Array.isArray(options.links) ? options.links : [options.links];
  }
  if (typeof saveNotes === 'function') saveNotes(notes);
  return note;
}

// --- Cloud Backup / Sync --------------------------------------------------

// Store Google Drive credentials only in memory to avoid persisting
// sensitive API keys in localStorage.
let gdriveCredentials = { clientId: null, apiKey: null };
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
let gdriveInitPromise = null;

function setGDriveCredentials(clientId, apiKey) {
  gdriveCredentials.clientId = clientId;
  gdriveCredentials.apiKey = apiKey;
}

function getGDriveClientId() {
  return gdriveCredentials.clientId;
}

function getGDriveApiKey() {
  return gdriveCredentials.apiKey;
}

function initGDrive() {
  if (!gdriveInitPromise) {
    gdriveInitPromise = new Promise((resolve, reject) => {
      if (!window.gapi) { gdriveInitPromise = null; return reject('gapi-not-loaded'); }
      const clientId = getGDriveClientId();
      const apiKey = getGDriveApiKey();
      if (!clientId || !apiKey) { gdriveInitPromise = null; return reject('gdrive credentials missing'); }
      gapi.load('client:auth2', () => {
        gapi.client.init({
          apiKey,
          clientId,
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
          scope: GDRIVE_SCOPES,
        }).then(resolve, err => { gdriveInitPromise = null; reject(err); });
      });
    });
  }
  return gdriveInitPromise;
}

function ensureGDriveAuth() {
  return initGDrive().then(() => {
    const auth = gapi.auth2.getAuthInstance();
    if (auth.isSignedIn.get()) return;
    return auth.signIn();
  });
}

function gdriveUpload() {
  const fileName = 'terminal-list-backup.json';
  const data = JSON.stringify({
    items: window.items || [],
    notes: window.notes || [],
    messages: window.messages || []
  });
  return ensureGDriveAuth()
    .then(() =>
      gapi.client.drive.files.list({
        q: `name='${fileName}' and trashed=false`,
        fields: 'files(id,name)'
      })
    )
    .then(res => {
      const fileId = res.result.files && res.result.files[0] && res.result.files[0].id;
      const blob = new Blob([data], { type: 'application/json' });
      const metadata = { name: fileName, mimeType: 'application/json' };
      return fileId
        ? gapi.client.drive.files.update({ fileId, resource: metadata, media: { body: blob } })
        : gapi.client.drive.files.create({ resource: metadata, media: { body: blob } });
    })
    .then(() => 'uploaded')
    .catch(err => { throw err && err.result ? err.result.error : err; });
}

function gdriveDownload() {
  const fileName = 'terminal-list-backup.json';
  return ensureGDriveAuth()
    .then(() => gapi.client.drive.files.list({
      q: `name='${fileName}' and trashed=false`,
      fields: 'files(id,name)'
    }))
    .then(res => {
      const fileId = res.result.files && res.result.files[0] && res.result.files[0].id;
      if (!fileId) throw 'no-data';
      return gapi.client.drive.files.get({ fileId, alt: 'media' });
    })
    .then(res => {
      const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.result;
      window.items = data.items || [];
      window.notes = data.notes || [];
      window.messages = data.messages || [];
      if (typeof saveItems === 'function') saveItems(window.items);
      if (typeof saveNotes === 'function') saveNotes(window.notes);
      if (typeof saveMessages === 'function') saveMessages(window.messages);
      if (typeof rescheduleAllNotifications === 'function') rescheduleAllNotifications();
      return 'downloaded';
    });
}

function syncWithCloud(provider = 'local', mode = 'upload') {
  if (provider === 'gdrive') {
    return mode === 'upload' ? gdriveUpload() : gdriveDownload();
  }

  const key = `terminal-list-sync-${provider}`;
  if (mode === 'upload') {
    const data = JSON.stringify({ items: window.items || [], notes: window.notes || [], messages: window.messages || [] });
    localStorage.setItem(key, data);
    return Promise.resolve('uploaded');
  } else {
    const raw = localStorage.getItem(key);
    if (!raw) return Promise.reject('no-data');
    const data = JSON.parse(raw);
    window.items = data.items || [];
    window.notes = data.notes || [];
    window.messages = data.messages || [];
    if (typeof saveItems === 'function') saveItems(window.items);
    if (typeof saveNotes === 'function') saveNotes(window.notes);
    if (typeof saveMessages === 'function') saveMessages(window.messages);
    if (typeof rescheduleAllNotifications === 'function') rescheduleAllNotifications();
    return Promise.resolve('downloaded');
  }
}

// --- Theme Presets -------------------------------------------------------

function applyThemePreset(preset) {
  if (!preset) return;
  if (typeof applyTheme === 'function') applyTheme(preset);
  if (typeof saveTheme === 'function') saveTheme(preset);
}

function exportThemePreset(name = 'theme') {
  const style = getComputedStyle(document.documentElement);
  const preset = {
    name,
    bg: style.getPropertyValue('--bg').trim(),
    fg: style.getPropertyValue('--fg').trim(),
    border: style.getPropertyValue('--border').trim()
  };
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return preset;
}

// --- Collaboration -------------------------------------------------------

function startCollaboration(sessionId, secret, saltBytes) {
  const channel = new BroadcastChannel(`tl-collab-${sessionId}`);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let salt = saltBytes ? new Uint8Array(saltBytes) : null;
  let keyPromise = null;

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

  channel.onmessage = async e => {
    try {
      if (e.data && e.data.salt && !salt) {
        salt = new Uint8Array(e.data.salt);
        showSalt();
        await getKey();
        return;
      }
      const key = await getKey();
      const { cipher, iv } = e.data || {};
      if (!cipher || !iv) return;
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        new Uint8Array(cipher)
      );
      const data = JSON.parse(decoder.decode(decrypted));
      if (data && data.items && data.notes) {
        window.items = data.items;
        window.notes = data.notes;
        window.messages = data.messages || [];
        if (typeof saveItems === 'function') saveItems(window.items);
        if (typeof saveNotes === 'function') saveNotes(window.notes);
        if (typeof saveMessages === 'function') saveMessages(window.messages);
        if (typeof rescheduleAllNotifications === 'function') rescheduleAllNotifications();
      }
    } catch (err) {
      // ignore invalid messages
    }
  };

  async function broadcast() {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = { items: window.items || [], notes: window.notes || [], messages: window.messages || [] };
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify(payload))
    );
    channel.postMessage({ cipher: Array.from(new Uint8Array(encrypted)), iv: Array.from(iv) });
  }

  return { channel, broadcast, getSalt: () => Array.from(salt || []) };
}

// Named exports for feature helpers
export {
  scheduleRecurringReminder,
  clearRecurringReminder,
  snoozeReminder,
  indexItems,
  parseAdvancedQuery,
  editNoteRich,
  syncWithCloud,
  applyThemePreset,
  exportThemePreset,
  startCollaboration,
  setGDriveCredentials,
  recurringTimers
};

