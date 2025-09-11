import { scheduleRecurringReminder, clearRecurringReminder, snoozeReminder, parseAdvancedQuery, applyThemePreset, exportThemePreset, setGDriveCredentials, syncWithCloud, recurringTimers, indexItems, registerDataGetters } from './features.js';
import stripImageMetadata from './third_party/strip-metadata.js';
let encryptionModule;
function loadEncryption() {
  if (!encryptionModule) encryptionModule = import("./encryption.js");
  return encryptionModule;
}

let collaborationModule;
function loadCollaboration() {
  if (!collaborationModule) collaborationModule = import("./collaboration.js");
  return collaborationModule;
}


// Load Google Drive credentials from config.json at runtime
fetch('./config.json')
  .then(r => r.json())
  .then(cfg => {
    if (cfg.clientId && cfg.apiKey) {
      setGDriveCredentials(cfg.clientId, cfg.apiKey);
    }
  })
  .catch(() => {
    // Missing or invalid config: credentials can be set manually via GDRIVECONFIG
  });

/************
 * STORAGE
 ************/
const STORE_KEY_V2 = 'terminal-list-state-v2'; // {items:[], notes:[], messages:[]} or {version,enc:{}}
const STORE_KEY_V1 = 'terminal-list-items-v1'; // legacy items-only

const enc = new TextEncoder();
const dec = new TextDecoder();
function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(str){ return Uint8Array.from(atob(str), c=>c.charCodeAt(0)); }
// Default scrypt parameters for deriving encryption keys. These values are
// stored alongside encrypted data so that they can be increased in the
// future without requiring data migration.
const DEFAULT_SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };

let passKey = null; // CryptoKey when unlocked
let passSalt = null; // base64 string
let passParams = { ...DEFAULT_SCRYPT_PARAMS };
let locked = false;

let dicewareWords = null;
async function loadDicewareWords() {
  if (!dicewareWords) {
    const res = await fetch('eff_large_wordlist.txt');
    const text = await res.text();
    dicewareWords = text.trim().split('\n').map(line => line.split('\t')[1]);
  }
  return dicewareWords;
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY_V2);
    if (raw){
      const obj = JSON.parse(raw);
      if (obj && obj.enc){
        // encrypted payload present
        locked = true;
        passSalt = obj.enc.salt;
        if (obj.enc.kdf && obj.enc.kdf.name === 'scrypt') {
          passParams = { N: obj.enc.kdf.N, r: obj.enc.kdf.r, p: obj.enc.kdf.p };
        } else {
          passParams = { ...DEFAULT_SCRYPT_PARAMS };
        }
        return { items: [], notes: [], messages: [], passwords: [] };
      }
      if (obj && Array.isArray(obj.items) && Array.isArray(obj.notes)){
        return {
          items: obj.items,
          notes: obj.notes,
          messages: Array.isArray(obj.messages) ? obj.messages : [],
          passwords: Array.isArray(obj.passwords) ? obj.passwords : []
        };
      }
    }
  }catch{}
  try{
    const raw1 = localStorage.getItem(STORE_KEY_V1);
    if (raw1){
      const items = JSON.parse(raw1) || [];
      const state = { items, notes: [], messages: [], passwords: [] };
      return state;
    }
  }catch{}
  return { items: [], notes: [], messages: [], passwords: [] };
}
async function saveState(state){
  if (!passKey) throw new Error('Passcode not set');
  try{
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = enc.encode(JSON.stringify({ items: state.items, notes: state.notes, messages: state.messages, passwords: state.passwords }));
    const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, passKey, data);
    const payload = { version: 4, enc: { v:1, salt: passSalt, kdf: { name:'scrypt', ...passParams }, iv: b64(iv), data: b64(buf) } };
    localStorage.setItem(STORE_KEY_V2, JSON.stringify(payload));
  }catch(err){ console.error(err); }
}
function makeId(){
  // Generate a 6-character URL-safe ID using cryptographically secure random values.
  const arr = new Uint32Array(1);
  const max = 36 ** 6;
  const limit = Math.floor(0x100000000 / max) * max;
  let n;
  do {
    crypto.getRandomValues(arr);
    n = arr[0];
  } while (n >= limit);
  return (n % max).toString(36).padStart(6, '0');
}

let state = loadState();
let items = state.items;
indexItems(items);
let needsNoteMigration = false;
let notes = state.notes.map(n=>{
  if (!n.body && n.text) needsNoteMigration = true;
  return {
    id: n.id,
    title: n.title || '',
    description: n.description || '',
    links: Array.isArray(n.links) ? n.links : (n.link ? [n.link] : []),
    attachments: n.attachments || [],
    body: n.body || n.text || '',
    tags: n.tags || [],
    taskId: n.taskId || null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
});
state.notes = notes;
if (needsNoteMigration) saveNotes(notes);
let messages = state.messages || [];
state.messages = messages;
let passwords = state.passwords || [];
state.passwords = passwords;
registerDataGetters({
  items: () => items,
  notes: () => notes,
  messages: () => messages,
  passwords: () => passwords
});

// Service Worker registration and notification timers
let swRegistration = null;
const dueTimers = new Map();

async function requestNotificationPermission(){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default'){
    try{ await Notification.requestPermission(); }catch(e){}
  }
}

function clearAllTimers(){
  for(const timer of dueTimers.values()) clearTimeout(timer);
  dueTimers.clear();
  for(const timer of recurringTimers.values()) clearInterval(timer);
  recurringTimers.clear();
}

function scheduleTaskNotification(t){
  // Clear previous timer if any
  if (dueTimers.has(t.id)){
    clearTimeout(dueTimers.get(t.id));
    dueTimers.delete(t.id);
  }
  if (!t.due || !swRegistration || Notification.permission !== 'granted') return;
  const dueTime = new Date(t.due + 'T00:00:00');
  const delay = dueTime.getTime() - Date.now();
  if (delay <= 0) return;
  const timer = setTimeout(()=>{
    swRegistration.showNotification('Task due', {
      body: t.text,
      tag: t.id,
      data: { id: t.id }
    });
  }, delay);
  dueTimers.set(t.id, timer);
}

function rescheduleAllNotifications(){
  items.forEach(scheduleTaskNotification);
}

document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState === 'hidden') {
    clearAllTimers();
    if (!locked) cmd.lock();
  }
});

window.addEventListener('beforeunload', () => {
  clearAllTimers();
  if (!locked) cmd.lock();
});

if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!navigator.serviceWorker.controller) clearAllTimers();
  });
}

function saveItems(v){ state.items = v; indexItems(v); saveState(state).catch(()=>{}); }
function saveNotes(v){
  notes = v;
  state.notes = v;
  saveState(state).catch(()=>{});
}
function saveMessages(v){
  messages = v;
  state.messages = v;
  saveState(state).catch(()=>{});
}
function savePasswords(v){
  passwords = v;
  state.passwords = v;
  saveState(state).catch(()=>{});
}
const IMAGE_DB = 'terminal-list-images';
let imageDbPromise = null;
function getImageDb(){
  if (!imageDbPromise){
    imageDbPromise = new Promise((resolve)=>{
      const req = indexedDB.open(IMAGE_DB,1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore('files'); };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>resolve(null);
    });
  }
  return imageDbPromise;
}
async function storeImageBlob(file){
  const db = await getImageDb();
  if (!db) return null;
  return new Promise((resolve)=>{
    const id = makeId() + Date.now();
    const tx = db.transaction('files','readwrite');
    tx.objectStore('files').put(file, id);
    tx.oncomplete = ()=>resolve(id);
    tx.onerror = ()=>resolve(null);
  });
}
async function loadImageBlob(id){
  const db = await getImageDb();
  if (!db) return null;
  return new Promise((resolve)=>{
    const tx = db.transaction('files','readonly');
    const req = tx.objectStore('files').get(id);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>resolve(null);
  });
}
// Only allow a small set of safe image types. If additional formats are enabled
// in the future, strip metadata or sanitize images server-side to avoid XSS or
// tracking vectors.
const ALLOWED_IMAGE_TYPES = ['image/png','image/jpeg','image/gif'];
function isImageAttachment(a){
  if (!a) return false;
  if (a.startsWith('idb:')) return true;
  return ALLOWED_IMAGE_TYPES.some(t=>a.startsWith(`data:${t}`));
}
async function resolveAttachmentUrl(a){
  if (a.startsWith('idb:')){
    const blob = await loadImageBlob(a.slice(4));
    return blob ? URL.createObjectURL(blob) : '';
  }
  return a;
}
function isSafeUrl(url){
  try{
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  }catch{
    return false;
  }
}
const THEME_KEY = 'terminal-theme';
function applyTheme(t){
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--fg', t.fg);
  root.setProperty('--border', t.border);
}
function loadTheme(){
  try{
    return JSON.parse(localStorage.getItem(THEME_KEY));
  }catch{}
  return null;
}
function saveTheme(t){
  localStorage.setItem(THEME_KEY, JSON.stringify(t));
}
const savedTheme = loadTheme();
if (savedTheme) applyTheme(savedTheme);

/************
 * UI HELPERS
 ************/
const output = document.getElementById('output');
const command = document.getElementById('command');
let awaitingLine = false;
const HISTORY_KEY = 'command-history';
let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
let historyIndex = history.length;

const INACTIVITY_MS = 5 * 60 * 1000;
let inactivityTimer = null;
function resetInactivityTimer(){
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(()=>{
    if (!locked) cmd.lock();
  }, INACTIVITY_MS);
}
function startInactivityTimer(){
  [command, modal, noteModal].forEach(el => {

    if (!el) return;
    el.addEventListener('keydown', resetInactivityTimer);
    el.addEventListener('pointerdown', resetInactivityTimer);
  });
  resetInactivityTimer();
}
function stopInactivityTimer(){

  [command, modal, noteModal].forEach(el => {

    if (!el) return;
    el.removeEventListener('keydown', resetInactivityTimer);
    el.removeEventListener('pointerdown', resetInactivityTimer);
  });
  clearTimeout(inactivityTimer);
}
const modal = document.getElementById('modal');
const btnCancel = document.getElementById('btn-cancel');
const btnOK = document.getElementById('btn-confirm');
const noteModal = document.getElementById('note-modal');
const noteModalTitle = document.getElementById('note-modal-title');
const noteTitleInput = document.getElementById('note-title');
const noteDescriptionInput = document.getElementById('note-description');
const noteLinksInput = document.getElementById('note-links');
const noteAttachmentsInput = document.getElementById('note-attachments');
const noteAttachmentsFiles = document.getElementById('note-attachments-files');
const noteAttachmentsPreview = document.getElementById('note-attachments-preview');
let pendingAttachmentFiles = [];
const noteBodyInput = document.getElementById('note-body');
const noteCancel = document.getElementById('note-cancel');
const noteSave = document.getElementById('note-save');
let editingNote = null;
const msgModal = document.getElementById('msg-modal');
const msgModalTitle = document.getElementById('msg-modal-title');
const msgFromInput = document.getElementById('msg-from');
const msgToInput = document.getElementById('msg-to');
const msgSubjectInput = document.getElementById('msg-subject');
const msgDateInput = document.getElementById('msg-date');
const msgTimeInput = document.getElementById('msg-time');
const msgBodyInput = document.getElementById('msg-body');
const msgPassInput = document.getElementById('msg-pass');
const msgCancel = document.getElementById('msg-cancel');
const msgShare = document.getElementById('msg-share');
let replyingMessage = null;
const passModal = document.getElementById('pass-modal');
const passModalTitle = document.getElementById('pass-modal-title');
const passTitleInput = document.getElementById('pass-title');
const passUsernameInput = document.getElementById('pass-username');
const passPasswordInput = document.getElementById('pass-password');
const passWebsiteInput = document.getElementById('pass-website');
const passNotesInput = document.getElementById('pass-notes');
const passCancel = document.getElementById('pass-cancel');
const passSave = document.getElementById('pass-save');
let editingPass = null;
const picModal = document.getElementById('pic-modal');
const picModalImg = document.getElementById('pic-modal-img');
const picClose = document.getElementById('pic-close');
let currentPicUrl = '';

function showAttachmentError(msg){
  const err = document.createElement('div');
  err.className = 'error';
  err.textContent = msg;
  noteAttachmentsPreview.appendChild(err);
  setTimeout(()=>err.remove(),2000);
}
function handleAttachmentFiles(fileList){
  Array.from(fileList).forEach(file=>{
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)){
      showAttachmentError('Unsupported file type');
      return;
    }
    const entry = { file, dataUrl: '' };
    pendingAttachmentFiles.push(entry);
    const reader = new FileReader();
    reader.onload = e=>{
      entry.dataUrl = e.target.result;
      const wrap = document.createElement('div');
      wrap.className = 'thumb';
      const img = document.createElement('img');
      img.src = entry.dataUrl;
      wrap.appendChild(img);
      const btn = document.createElement('button');
      btn.textContent = '\u00d7';
      btn.className = 'remove';
      btn.addEventListener('click', ()=>{
        pendingAttachmentFiles = pendingAttachmentFiles.filter(x=>x !== entry);
        wrap.remove();
      });
      wrap.appendChild(btn);
      noteAttachmentsPreview.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
}
noteAttachmentsFiles.addEventListener('change', ()=>{
  handleAttachmentFiles(noteAttachmentsFiles.files);
  noteAttachmentsFiles.value = '';
});
noteAttachmentsPreview.addEventListener('dragenter', e=>{
  e.preventDefault();
  noteAttachmentsPreview.classList.add('dragover');
});
noteAttachmentsPreview.addEventListener('dragover', e=>{
  e.preventDefault();
});
noteAttachmentsPreview.addEventListener('dragleave', e=>{
  e.preventDefault();
  noteAttachmentsPreview.classList.remove('dragover');
});
noteAttachmentsPreview.addEventListener('drop', e=>{
  e.preventDefault();
  noteAttachmentsPreview.classList.remove('dragover');
  if (e.dataTransfer && e.dataTransfer.files.length){
    handleAttachmentFiles(e.dataTransfer.files);
  }
});
noteModal.addEventListener('paste', e=>{
  if (e.clipboardData && e.clipboardData.files.length){
    handleAttachmentFiles(e.clipboardData.files);
    e.preventDefault();
  }
});

function println(text, cls){
  const div = document.createElement('div');
  div.className = 'line' + (cls ? ' ' + cls : '');
  div.textContent = text;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}
function countNotesForTask(taskId){
  return notes.filter(n => n.taskId === taskId).length;
}
function printTask(t, indexShown){
  const box = t.done ? '☑' : '☐';
  const pri = t.pri === 'H' ? ' !H' : t.pri === 'M' ? ' !M' : t.pri === 'L' ? ' !L' : '';
  const tags = (t.tags||[]).map(s=>' @'+s).join('');
  const due = t.due ? ' ^' + t.due : '';
  const idx = typeof indexShown === 'number' ? '['+indexShown+'] ' : '';
  const noteCount = countNotesForTask(t.id);
  const noteBadge = noteCount ? ` [📝x${noteCount}]` : '';
  const line = `${idx}(${t.id}) ${box} ${t.text}${tags}${due}${pri}${noteBadge}`;
  const div = document.createElement('div');
  div.className = 'line' + (t.done ? ' task-done' : '');
  div.textContent = line;
  output.appendChild(div);
}
function printList(arr, title){
  if (title) println(title, 'muted');
  if (!arr.length){ println('— no items —', 'muted'); return; }
  arr.forEach((t,i)=>printTask(t,i+1));
  output.scrollTop = output.scrollHeight;
}
function printNote(n, indexShown){
  const idx = typeof indexShown === 'number' ? '['+indexShown+'] ' : '';
  const tags = (n.tags||[]).map(s=>' @'+s).join('');
  const taskLink = n.taskId ? ` linked:(${n.taskId})` : '';
  const line = `${idx}(${n.id}) 📝 ${n.title || ''} — ${n.description || ''}${tags}${taskLink}`;
  const div = document.createElement('div');
  div.className = 'line';
  div.textContent = line;
  output.appendChild(div);
  if (n.attachments && n.attachments.length){
    const adiv = document.createElement('div');
    adiv.className = 'line';
    n.attachments.forEach(att=>{
      if (isImageAttachment(att)){
        const img = document.createElement('img');
        img.style.maxWidth = '64px';
        img.style.maxHeight = '64px';
        img.style.marginRight = '6px';
        resolveAttachmentUrl(att).then(url=>{ if (url) img.src = url; });
        adiv.appendChild(img);
      } else if (isSafeUrl(att)) {
        const a = document.createElement('a');
        a.href = att;
        a.textContent = att;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.marginRight = '6px';
        adiv.appendChild(a);
      } else {
        console.warn('Skipping unsafe attachment URL:', att);
      }
    });
    output.appendChild(adiv);
  }
}
function printNotes(arr, title){
  if (title) println(title, 'muted');
  if (!arr.length){ println('— no notes —', 'muted'); return; }
  arr.forEach((n,i)=>printNote(n,i+1));
  output.scrollTop = output.scrollHeight;
}

function printMessage(m, indexShown){
  const idx = typeof indexShown === 'number' ? '['+indexShown+'] ' : '';
  const line = `${idx}(${m.id}) ${m.from} -> ${m.to} : ${m.subject || ''} [${m.date} ${m.time}]`;
  const div = document.createElement('div');
  div.className = 'line';
  div.textContent = line;
  output.appendChild(div);
}
function printMessages(arr, title){
  if (title) println(title, 'muted');
  if (!arr.length){ println('— no messages —', 'muted'); return; }
  arr.forEach((m,i)=>printMessage(m,i+1));
  output.scrollTop = output.scrollHeight;
}

function printPassword(p, indexShown){
  const idx = typeof indexShown === 'number' ? '[' + indexShown + '] ' : '';
  const line = `${idx}(${p.id}) 🔐 ${p.title || ''} — ${p.username || ''}`;
  const div = document.createElement('div');
  div.className = 'line';
  div.textContent = line;
  output.appendChild(div);
}

function printPasswords(arr, title){
  if (title) println(title, 'muted');
  if (!arr.length){ println('— no passwords —', 'muted'); return; }
  arr.forEach((p,i)=>printPassword(p,i+1));
  output.scrollTop = output.scrollHeight;
}

function printPasswordDetails(p){
  println('(' + p.id + ')');
  println('Title: ' + (p.title || ''));
  println('Username: ' + (p.username || ''));
  println('Password: ' + (p.password || ''));
  println('Website: ' + (p.website || ''));
  println('Notes: ' + (p.notes || ''));
}

/************
 * FILTER/RESOLUTION
 ************/
function listFilteredTasks(filter, sortBy){
  let arr = [...items];
  if (sortBy === 'due') {
    arr.sort((a,b)=>{
      if (!a.due && !b.due) return a.createdAt - b.createdAt;
      if (!a.due) return 1;
      if (!b.due) return -1;
      if (a.due === b.due) return a.createdAt - b.createdAt;
      return a.due.localeCompare(b.due);
    });
  } else if (sortBy === 'pri') {
    const order = {H:0, M:1, L:2};
    arr.sort((a,b)=>{
      const pa = order[a.pri] ?? 3;
      const pb = order[b.pri] ?? 3;
      if (pa === pb) return a.createdAt - b.createdAt;
      return pa - pb;
    });
  } else {
    arr.sort((a,b)=>a.createdAt - b.createdAt);
  }
  if (!filter || filter==='open') arr = arr.filter(t=>!t.done);
  else if (filter==='done') arr = arr.filter(t=>t.done);
  else if (filter==='all') { }
  else if (filter.startsWith('@')) {
    const tag = filter.slice(1).toLowerCase();
    arr = arr.filter(t=>(t.tags||[]).map(s=>s.toLowerCase()).includes(tag));
  }
  return arr;
}
function listFilteredNotes(filter){
  let arr = [...notes];
  arr.sort((a,b)=>a.createdAt - b.createdAt);
  if (!filter || filter==='all') { /* no-op */ }
  else if (filter.startsWith('@')) {
    const tag = filter.slice(1).toLowerCase();
    arr = arr.filter(n=>(n.tags||[]).map(s=>s.toLowerCase()).includes(tag));
  } else if (filter.startsWith('task:')){
    const ref = filter.slice(5).trim();
    const t = resolveTaskRef(ref, lastTaskListCache);
    if (t) arr = arr.filter(n=>n.taskId === t.id);
    else arr = [];
  }
  return arr;
}
function listMessages(){
  return [...messages].sort((a,b)=> new Date(b.date+' '+b.time) - new Date(a.date+' '+a.time));
}

function listPasswords(){
  return [...passwords].sort((a,b)=> (a.title||'').localeCompare(b.title||''));
}
function resolveTaskRef(ref, currentList){
  if (!ref) return null;
  const byId = items.find(t=>t.id === ref);
  if (byId) return byId;
  if (/^\d+$/.test(ref)){
    const n = parseInt(ref,10);
    if (currentList && n>=1 && n<=currentList.length) return currentList[n-1];
    if (n>=1 && n<=items.length) return items[n-1];
  }
  return null;
}
function resolveNoteRef(ref, currentList){
  if (!ref) return null;
  const byId = notes.find(n=>n.id === ref);
  if (byId) return byId;
  if (/^\d+$/.test(ref)){
    const n = parseInt(ref,10);
    if (currentList && n>=1 && n<=currentList.length) return currentList[n-1];
    if (n>=1 && n<=notes.length) return notes[n-1];
  }
  return null;
}
function resolveMessageRef(ref, currentList){
  if (!ref) return null;
  const byId = messages.find(m=>m.id === ref);
  if (byId) return byId;
  if (/^\d+$/.test(ref)){
    const n = parseInt(ref,10);
    if (currentList && n>=1 && n<=currentList.length) return currentList[n-1];
    if (n>=1 && n<=messages.length) return messages[n-1];
  }
  return null;
}

function resolvePasswordRef(ref, currentList){
  if (!ref) return null;
  const byId = passwords.find(p=>p.id === ref);
  if (byId) return byId;
  if (/^\d+$/.test(ref)){
    const n = parseInt(ref,10);
    if (currentList && n>=1 && n<=currentList.length) return currentList[n-1];
    if (n>=1 && n<=passwords.length) return passwords[n-1];
  }
  return null;
}

/************
 * COMMANDS
 ************/
const cmd = {};
cmd.help = () => {
  println('Tasks:');
  println('  - add <text> — add a new item');
  println('  - list [all|open|done|@tag] — list items; @tag also shows notes');
  println('  - show <id|#> — show a task with attached notes');
  println('  - done <id|#> — mark done');
  println('  - undone <id|#> — unmark done');
  println('  - delete <id|#> — delete item');
  println('  - edit <id|#> <text> — edit text');
  println('  - move <id|#> <up|down|n> — reorder item');
  println('  - tag <id|#> +foo -bar — add/remove tags');
  println('  - due <id|#> <YYYY-MM-DD> — set due date (or "clear")');
  println('  - priority <id|#> <H|M|L> — set priority');
  println('  - search <query> — find text in items');
  println('  - share <id|#> — share a task encrypted with a passcode');
  println('');
  println('Notes:');
  println('  - note <title>|<desc>|[link]|[body] — add a note');
  println('  - notes [all|@tag|task:<ref>] — list notes');
  println('  - nedit <id|#> <title>|<desc>|[link]|[body] — edit a note');
  println('  - readnote <id|#> — show all fields for a note');
  println('  - seepic <id|#> — open a note\'s image attachment in a modal');
  println('  - dlpic <id|#> — download a note\'s image attachment');
  println('  - ndelete <id|#> — delete a note');
  println('  - nlink <note|#> <task|#> — link a note to a task');
  println('  - nunlink <note|#> — unlink note from task');
  println('  - ntag <id|#> +foo -bar — add/remove tags');
  println('  - nsearch <query> — find text in notes');
  println('  - nshare <id|#> — share a note encrypted with a passcode');
  println('');
  println('Messages:');
  println('  - msgs — list messages');
  println('  - sendmsg — compose and share an encrypted message');
  println('  - recmsg — paste shared message JSON and decrypt with a passcode');
  println('  - readmsg <id|#> — read a message');
  println('  - replymsg <id|#> — reply to a message');
  println('  - delmsg <id|#> — delete a message');
  println('');
  println('Passwords:');
  println('  - passlist — list password sets');
  println('  - passnew — add a password set');
  println('  - passedit <id|#> — edit a password set');
  println('  - passdel <id|#> — delete a password set');
  println('  - passview <id|#> — show a password set');
  println('');
  println('Security & Data:');
  println('  - stats — summary counts');
  println('  - clear — clear the display');
  println('  - export — download JSON (tasks + notes + messages)');
  println('  - import — paste JSON to replace all data');
  println('  - importshare — paste shared item JSON and decrypt with a passcode');
  println('  - wipe — clear all data (with confirm)');
  println('  - genpass — generate a Diceware passphrase');
  println('  - setpass — set passcode');
  println('  - lock — clear decrypted data from memory');
  println('  - unlock — restore data with passcode');
  println('');
  println('Other:');
  println('  - syntax <command> — show detailed usage for a command');
  println('  - theme <bg> <fg> <border> — set terminal colors');
  println('  - update — refresh cached files from the service worker');
  println('');
  println('Experimental Feature Commands:');
  println('  - recur <id|#> <n> <unit> — schedule recurring reminder (unit = minute|hour|day|week)');
  println('  - snooze <id|#> <YYYY-MM-DD> — snooze a task to a new date');
  println('  - aquery <query> — run an advanced task query (tag/due/done/pri filters; due:overdue for past-due tasks)');
  println('  - nrich <id|#> <title>|[body]|[link]|[attachments] — edit note with rich fields; attachments are a comma-separated list of URLs or data URIs');
  println('  - backup [provider] [upload|download] — passcode-encrypted sync to a sandbox provider (local or gdrive)');
  println('  - gdriveconfig <client_id> <api_key> — store Google Drive credentials for backup');
  println('  - themepreset <json> — apply a theme preset from JSON');
  println('  - themeexport [name] — download current theme preset');
  println('  - collab <session> <secret> — join a collaboration channel and broadcast tasks/notes');
};

let lastTaskListCache = null;
cmd.add = (args)=>{
  const text = args.join(' ').trim();
  if (!text){ println('usage: ADD <text>', 'error'); return; }
  const t = { id: makeId(), text, done:false, tags:[], due:null, pri:null, createdAt: Date.now(), doneAt:null };
  items.push(t); saveItems(items);
  println('added.', 'ok'); printTask(t);
};
cmd.list = (args)=>{
  let filter = 'open';
  let sortBy = null;
  if (args[0] && !args[0].startsWith('--')) filter = args[0];
  const sortArg = args.find(a=>a.startsWith('--sort='));
  if (sortArg) sortBy = sortArg.slice(7);
  lastTaskListCache = listFilteredTasks(filter, sortBy);
  let title = 'LIST ' + filter.toUpperCase();
  if (sortBy) title += ' SORTED BY ' + sortBy.toUpperCase();
  printList(lastTaskListCache, title);
  if (filter.startsWith('@')) {
    lastNoteListCache = listFilteredNotes(filter);
    printNotes(lastNoteListCache, 'NOTES ' + filter.toUpperCase());
  } else {
    lastNoteListCache = null;
  }
};
cmd.show = (args)=>{
  const ref = args[0];
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  printTask(t);
  const attached = notes.filter(n=>n.taskId === t.id);
  if (attached.length){
    println('— notes —', 'muted');
    attached.forEach((n,i)=>printNote(n,i+1));
  }else{
    println('— no notes —', 'muted');
  }
};
cmd.done = (args)=>{
  const t = resolveTaskRef(args[0], lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  t.done = true; t.doneAt = Date.now(); saveItems(items);
  println('marked done.', 'ok'); printTask(t);
};
cmd.undone = (args)=>{
  const t = resolveTaskRef(args[0], lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  t.done = false; t.doneAt = null; saveItems(items);
  println('marked undone.', 'ok'); printTask(t);
};
cmd.delete = (args)=>{
  const t = resolveTaskRef(args[0], lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  clearRecurringReminder(t.id);
  notes.forEach(n=>{ if (n.taskId === t.id) n.taskId = null; });
  if (dueTimers.has(t.id)){
    clearTimeout(dueTimers.get(t.id));
    dueTimers.delete(t.id);
  }
  items = items.filter(x=>x.id!==t.id); saveItems(items); saveNotes(notes);
  println('deleted.', 'ok');
};
cmd.edit = (args)=>{
  const ref = args.shift();
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  clearRecurringReminder(t.id);
  const text = args.join(' ').trim();
  if (!text) return println('usage: EDIT <id|#> <text>', 'error');
  t.text = text; saveItems(items);
  println('edited.', 'ok'); printTask(t);
};
cmd.move = (args)=>{
  const ref = args[0]; const how = args[1];
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  const idx = items.findIndex(x=>x.id===t.id);
  if (how === 'up' && idx>0){
    [items[idx-1], items[idx]] = [items[idx], items[idx-1]];
  } else if (how === 'down' && idx < items.length-1){
    [items[idx+1], items[idx]] = [items[idx], items[idx+1]];
  } else if (/^\d+$/.test(how)){
    let n = Math.max(0, Math.min(items.length-1, parseInt(how,10)-1));
    items.splice(idx,1);
    items.splice(n,0,t);
  } else {
    return println('usage: MOVE <id|#> <up|down|position#>', 'error');
  }
  saveItems(items);
  println('moved.', 'ok');
};
cmd.tag = (args)=>{
  const ref = args.shift();
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  t.tags = t.tags || [];
  for (const tok of args){
    if (tok.startsWith('+')){
      const tag = tok.slice(1);
      if (!t.tags.includes(tag)) t.tags.push(tag);
    } else if (tok.startsWith('-')){
      const tag = tok.slice(1);
      t.tags = t.tags.filter(x=>x!==tag);
    }
  }
  saveItems(items);
  println('tags updated.', 'ok'); printTask(t);
};
cmd.due = (args)=>{
  const ref = args.shift();
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  const val = (args[0]||'').toLowerCase();
  if (!val) return println('usage: DUE <id|#> <YYYY-MM-DD|clear>', 'error');
  if (val==='clear'){ t.due = null; }
  else { t.due = val; }
  saveItems(items);
  scheduleTaskNotification(t);
  if ('Notification' in window && Notification.permission === 'default') {
    requestNotificationPermission().then(rescheduleAllNotifications);
  }
  println('due updated.', 'ok'); printTask(t);
};
cmd.priority = (args)=>{
  const ref = args.shift();
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  const p = (args[0]||'').toUpperCase();
  if (!['H','M','L'].includes(p)) return println('usage: PRIORITY <id|#> <H|M|L>', 'error');
  t.pri = p; saveItems(items);
  println('priority updated.', 'ok'); printTask(t);
};
cmd.search = (args)=>{
  const q = args.join(' ').toLowerCase();
  if (!q) return println('usage: SEARCH <query>', 'error');
  const hits = items.filter(t=> (t.text||'').toLowerCase().includes(q));
  printList(hits, 'SEARCH TASKS: ' + q);
};

cmd.recur = (args)=>{
  const ref = args[0];
  const every = parseInt(args[1], 10);
  const unit = args[2];
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t || !every || !unit){
    return println('usage: RECUR <id|#> <n> <minute|hour|day|week>', 'error');
  }
  scheduleRecurringReminder(t.id, { every, unit });
  if ('Notification' in window && Notification.permission === 'default') {
    requestNotificationPermission().then(rescheduleAllNotifications);
  }
  println('recurrence scheduled.', 'ok');
};

cmd.snooze = (args)=>{
  const t = resolveTaskRef(args[0], lastTaskListCache);
  const until = args[1];
  if (!t || !until){
    return println('usage: SNOOZE <id|#> <YYYY-MM-DD>', 'error');
  }
  snoozeReminder(t.id, until);
  if ('Notification' in window && Notification.permission === 'default') {
    requestNotificationPermission().then(rescheduleAllNotifications);
  }
  println('snoozed.', 'ok');
  printTask(t);
};

cmd.aquery = (args)=>{
  const q = args.join(' ');
  if (!q) return println('usage: AQUERY <query>', 'error');
  const ids = parseAdvancedQuery(q);
  const hits = items.filter(t=> ids.includes(t.id));
  printList(hits, 'ADV QUERY: ' + q);
};

cmd.share = async (args)=>{
  const ref = args[0];
  const t = resolveTaskRef(ref, lastTaskListCache);
  if (!t) return println('id does not exist', 'error');
  println('Enter share passcode:', 'muted');
  const pass = await getNextLine(true);
  const { encryptForShare } = await loadEncryption();
  const encPayload = await encryptForShare(t, pass);
  const payload = { version:1, type:'item', enc: encPayload };
  const json = JSON.stringify(payload);
  if (navigator.share){
    try { await navigator.share({ text: json }); println('shared.', 'ok'); }
    catch(e){ println('share canceled.', 'muted'); }
  } else {
    println(json, 'muted');
  }
};

// Notes
let lastNoteListCache = null;
cmd.note = ()=>{
  showNoteModal();
};
cmd.notes = (args)=>{
  const filter = args[0] || 'all';
  lastNoteListCache = listFilteredNotes(filter);
  printNotes(lastNoteListCache, 'NOTES ' + filter.toUpperCase());
};
cmd.nedit = (args)=>{
  const ref = args.shift();
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  showNoteModal(n);
};

cmd.nrich = (args)=>{
  const ref = args.shift();
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  showNoteModal(n);
};
cmd.ndelete = (args)=>{
  const ref = args[0];
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  notes = notes.filter(x=>x.id!==n.id); saveNotes(notes);
  println('note deleted.', 'ok');
};
cmd.nlink = (args)=>{
  const noteRef = args[0];
  const taskRef = args[1];
  if (!noteRef || !taskRef) return println('usage: NLINK <note|#> <task|#>', 'error');
  const n = resolveNoteRef(noteRef, lastNoteListCache);
  const t = resolveTaskRef(taskRef, lastTaskListCache);
  if (!n || !t) return println('id does not exist', 'error');
  n.taskId = t.id; n.updatedAt = Date.now(); saveNotes(notes);
  println('note linked.', 'ok'); printNote(n);
};
cmd.nunlink = (args)=>{
  const noteRef = args[0];
  const n = resolveNoteRef(noteRef, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  n.taskId = null; n.updatedAt = Date.now(); saveNotes(notes);
  println('note unlinked.', 'ok'); printNote(n);
};
cmd.ntag = (args)=>{
  const ref = args.shift();
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  n.tags = n.tags || [];
  for (const tok of args){
    if (tok.startsWith('+')){
      const tag = tok.slice(1);
      if (!n.tags.includes(tag)) n.tags.push(tag);
    } else if (tok.startsWith('-')){
      const tag = tok.slice(1);
      n.tags = n.tags.filter(x=>x!==tag);
    }
  }
  n.updatedAt = Date.now();
  saveNotes(notes);
  println('tags updated.', 'ok'); printNote(n);
};
cmd.nsearch = (args)=>{
  const q = args.join(' ').toLowerCase();
  if (!q) return println('usage: NSEARCH <query>', 'error');
  const hits = notes.filter(n=> [n.title, n.description, ...(n.links||[]), n.body || n.text].some(f => (f||'').toLowerCase().includes(q)));
  printNotes(hits, 'SEARCH NOTES: ' + q);
};

cmd.nshare = async (args)=>{
  const ref = args[0];
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  println('Enter share passcode:', 'muted');
  const pass = await getNextLine(true);
  const { encryptForShare } = await loadEncryption();
  const encPayload = await encryptForShare(n, pass);
  const payload = { version:1, type:'note', enc: encPayload };
  const json = JSON.stringify(payload);
  if (navigator.share){
    try { await navigator.share({ text: json }); println('shared.', 'ok'); }
    catch(e){ println('share canceled.', 'muted'); }
  } else {
    println(json, 'muted');
  }
};

cmd.readnote = (args)=>{
  const ref = args[0];
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  println('(' + n.id + ')');
  println('Title: ' + (n.title || ''));
  println('Description: ' + (n.description || ''));
  const links = (n.links || []).join(', ');
  println('Links: ' + (links || ''));
  println('Body: ' + (n.body || n.text || ''));
  if (n.attachments && n.attachments.length){
    const adiv = document.createElement('div');
    adiv.className = 'line';
    adiv.appendChild(document.createTextNode('Attachments: '));
    n.attachments.forEach(att=>{
      if (isImageAttachment(att)){
        const img = document.createElement('img');
        img.style.maxWidth = '100px';
        img.style.maxHeight = '100px';
        img.style.marginRight = '6px';
        resolveAttachmentUrl(att).then(url=>{ if (url) img.src = url; });
        adiv.appendChild(img);
      } else if (isSafeUrl(att)) {
        const a = document.createElement('a');
        a.href = att;
        a.textContent = att;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.marginRight = '6px';
        adiv.appendChild(a);
      } else {
        console.warn('Skipping unsafe attachment URL:', att);
      }
    });
    output.appendChild(adiv);
  } else {
    println('Attachments: ');
  }
  const tags = (n.tags||[]).map(t=>'@'+t).join(' ');
  println('Tags: ' + tags);
  println('Linked Task: ' + (n.taskId || ''));
};

cmd.seepic = (args)=>{
  const ref = args[0];
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  const att = (n.attachments || []).find(isImageAttachment);
  if (!att) return println('no image attachment', 'error');
  resolveAttachmentUrl(att).then(url=>{
    if (!url) return println('failed to load', 'error');
    showPicModal(url);
  });
};

cmd.dlpic = (args)=>{
  const ref = args[0];
  const n = resolveNoteRef(ref, lastNoteListCache);
  if (!n) return println('id does not exist', 'error');
  const att = (n.attachments || []).find(isImageAttachment);
  if (!att) return println('no image attachment', 'error');
  resolveAttachmentUrl(att).then(url=>{
    if (!url) return println('failed to load', 'error');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'note-' + n.id + '-image';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      document.body.removeChild(a);
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }, 0);
  });
};

let lastMsgListCache = null;
cmd.msgs = ()=>{
  lastMsgListCache = listMessages();
  printMessages(lastMsgListCache, 'MESSAGES');
};
cmd.sendmsg = ()=>{
  showMessageModal();
};
cmd.recmsg = async ()=>{
  println('Paste shared JSON and press Enter. Type CANCEL to abort.', 'muted');
  const text = await getNextLine();
  if (text.trim().toLowerCase() === 'cancel'){ println('import canceled.','muted'); return; }
  try{
    const payload = JSON.parse(text);
    if (!payload || payload.type !== 'message' || !payload.enc) throw new Error('invalid format');
    println('Enter share passcode:', 'muted');
    const pass = await getNextLine(true);
    const { decryptShared } = await loadEncryption();
    const obj = await decryptShared(payload.enc, pass);
    delete obj.passcode;
    if (!obj.id) obj.id = makeId();
    const idx = messages.findIndex(m=>m.id===obj.id);
    if (idx>=0) messages[idx]=obj; else messages.push(obj);
    messages.sort((a,b)=> new Date(b.date+' '+b.time) - new Date(a.date+' '+a.time));
    saveMessages(messages);
    println('message received.', 'ok');
  }catch(e){
    println('import failed: ' + e.message, 'error');
  }
};
cmd.readmsg = (args)=>{
  const ref = args[0];
  const m = resolveMessageRef(ref, lastMsgListCache);
  if (!m) return println('id does not exist', 'error');
  println('(' + m.id + ')');
  println('From: ' + (m.from || ''));
  println('To: ' + (m.to || ''));
  println('Subject: ' + (m.subject || ''));
  println('Date: ' + (m.date || '') + ' ' + (m.time || ''));
  println('Message: ' + (m.message || ''));
  const div = document.createElement('div');
  div.className = 'line';
  const btn = document.createElement('button');
  btn.textContent = 'Reply';
  btn.addEventListener('click', ()=>parseAndRun('REPLYMSG ' + m.id));
  div.appendChild(btn);
  output.appendChild(div);
};
cmd.replymsg = (args)=>{
  const ref = args[0];
  const m = resolveMessageRef(ref, lastMsgListCache);
  if (!m) return println('id does not exist', 'error');
  showMessageModal(m);
};
cmd.delmsg = (args)=>{
  const ref = args[0];
  const m = resolveMessageRef(ref, lastMsgListCache);
  if (!m) return println('id does not exist', 'error');
  messages = messages.filter(x=>x.id!==m.id);
  saveMessages(messages);
  println('message deleted.', 'ok');
};

let lastPassListCache = null;
cmd.passlist = ()=>{
  lastPassListCache = listPasswords();
  printPasswords(lastPassListCache, 'PASSWORDS');
};
cmd.passnew = ()=>{
  showPassModal();
};
cmd.passedit = (args)=>{
  const ref = args[0];
  const p = resolvePasswordRef(ref, lastPassListCache);
  if (!p) return println('id does not exist', 'error');
  showPassModal(p);
};
cmd.passdel = (args)=>{
  const ref = args[0];
  const p = resolvePasswordRef(ref, lastPassListCache);
  if (!p) return println('id does not exist', 'error');
  passwords = passwords.filter(x=>x.id!==p.id);
  savePasswords(passwords);
  println('password deleted.','ok');
};
cmd.passview = (args)=>{
  const ref = args[0];
  const p = resolvePasswordRef(ref, lastPassListCache);
  if (!p) return println('id does not exist', 'error');
  printPasswordDetails(p);
};

// General
cmd.syntax = (args)=>{
  const topic = (args[0] || '').toLowerCase();
  const info = {
    nrich: [
      'NRICH <id|#> <title>|[body]|[link]|[attachments]',
      '  Rich edit a note; fields separated by "|".',
      '  title        new title (optional)',
      '  body         note body (optional)',
      '  link         URL or note:<id> (optional)',
      '  attachments  comma-separated URLs or data URIs (optional)'
    ],
    note: [
      'NOTE <title>|<desc>|[link]|[body]',
      '  Create a note; fields separated by "|".',
      '  link and body are optional.',
      '  Use NRICH to add attachments later.'
    ],
    seepic: [
      'SEEPIC <id|#>',
      '  Open first image attachment of note in modal'
    ],
    dlpic: [
      'DLPIC <id|#>',
      '  Download first image attachment of note'
    ],
    ntag: [
      'NTAG <id|#> +foo -bar',
      '  Add (+) or remove (-) tags from a note'
    ],
    share: [
      'SHARE <id|#>',
      '  Share a task encrypted with a passcode'
    ],
    nshare: [
      'NSHARE <id|#>',
      '  Share a note encrypted with a passcode'
    ],
    importshare: [
      'IMPORTSHARE',
      '  Paste shared item JSON, then enter its passcode'
    ],
    genpass: [
      'GENPASS [-w <n>] [-s <sep>]',
      '  Generate a Diceware passphrase'
    ],
    sendmsg: [
      'SENDMSG',
      '  Compose and share an encrypted message'
    ],
    recmsg: [
      'RECMSG',
      '  Paste shared message JSON, then enter its passcode'
    ],
    readmsg: [
      'READMSG <id|#>',
      '  Read a message'
    ],
    replymsg: [
      'REPLYMSG <id|#>',
      '  Reply to a message'
    ],
    delmsg: [
      'DELMSG <id|#>',
      '  Delete a message'
    ],
    msgs: [
      'MSGS',
      '  List messages in reverse chronological order'
    ],
    passlist: [
      'PASSLIST',
      '  List password sets'
    ],
    passnew: [
      'PASSNEW',
      '  Add a password set'
    ],
    passedit: [
      'PASSEDIT <id|#>',
      '  Edit a password set'
    ],
    passdel: [
      'PASSDEL <id|#>',
      '  Delete a password set'
    ],
    passview: [
      'PASSVIEW <id|#>',
      '  Show a password set'
    ]
  };
  if (!topic || !info[topic]) {
    println('usage: SYNTAX <command>', 'muted');
    println('available: ' + Object.keys(info).map(k=>k.toUpperCase()).join(', '), 'muted');
    return;
  }
  info[topic].forEach(line => println(line));
};
cmd.clear = ()=>{
  output.innerHTML = '';
  lastTaskListCache = null;
  lastNoteListCache = null;
  lastMsgListCache = null;
  lastPassListCache = null;
};
cmd.stats = ()=>{
  const total = items.length;
  const done = items.filter(t=>t.done).length;
  const open = total - done;
  const noteCount = notes.length;
  const msgCount = messages.length;
  const passCount = passwords.length;
  println(`Tasks — Total: ${total}  Open: ${open}  Done: ${done}`);
  println(`Notes — Total: ${noteCount}`);
  println(`Messages — Total: ${msgCount}`);
  println(`Passwords — Total: ${passCount}`);
};
cmd.theme = (args)=>{
  if (args.length !== 3){
    println('usage: THEME <bg> <fg> <border>', 'error');
    return;
  }
  const [bg, fg, border] = args;
  applyTheme({ bg, fg, border });
  saveTheme({ bg, fg, border });
  println('theme updated.', 'ok');
};

cmd.themepreset = (args)=>{
  const json = args.join(' ');
  if (!json) return println('usage: THEMEPRESET <json>', 'error');
  try {
    const preset = JSON.parse(json);
    applyThemePreset(preset);
    println('theme preset applied.', 'ok');
  } catch(e){
    println('invalid preset', 'error');
  }
};

cmd.themeexport = (args)=>{
  const name = args[0] || 'theme';
  exportThemePreset(name);
  println('theme exported.', 'ok');
};

cmd.update = async () => {
  println('refreshing cache...', 'muted');
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('terminal-list-')).map(k => caches.delete(k)));
  if (swRegistration && swRegistration.active) {
    swRegistration.active.postMessage({ type: 'PRECACHE' });
    try { await swRegistration.update(); } catch (e) {}
  }
  println('cache refreshed. reload page to use updated assets.', 'ok');
};

cmd.gdriveconfig = (args)=>{
  const clientId = args[0];
  const apiKey = args[1];
  if (!clientId || !apiKey){
    println('usage: GDRIVECONFIG <client_id> <api_key>', 'error');
    return;
  }
  setGDriveCredentials(clientId, apiKey);
  println('gdrive credentials stored for this session. Keep your keys secure.', 'ok');
};

cmd.backup = async (args)=>{
  const provider = args[0] || 'local';
  const mode = args[1] || 'upload';
  if (!passSalt){ println('no passcode set', 'error'); return; }
  println('Enter passcode:', 'muted');
  const pass = await getNextLine(true);
  try {
    await syncWithCloud(provider, mode, pass);
    println(mode === 'upload' ? 'backup uploaded.' : 'backup restored.', 'ok');
  } catch (err) {
    println('backup failed: ' + err, 'error');
  }
};

let collabSession = null;
cmd.collab = async (args)=>{
  const session = args[0];
  const secret = args[1];
  if (!session || !secret) return println('usage: COLLAB <session> <secret>', 'error');
  const { startCollaboration } = await loadCollaboration();
  collabSession = startCollaboration(session, secret);
  if (collabSession && collabSession.broadcast) collabSession.broadcast();
  println('collaboration started.', 'ok');
};
function download(filename, text) {
  const a = document.createElement('a');
  a.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(text));
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
}
cmd.export = ()=>{
  const payload = { version: 3, items, notes, messages, passwords };
  const json = JSON.stringify(payload, null, 2);
  download('terminal-list-export.json', json);
  println('exported.', 'ok');
};
cmd.import = async ()=>{
  println('Paste JSON and press Enter. Type CANCEL to abort.', 'muted');
  const text = await getNextLine();
  if (text.trim().toLowerCase() === 'cancel'){ println('import canceled.','muted'); return; }
  try{
    const incoming = JSON.parse(text);
    if (Array.isArray(incoming)){
      items = incoming;
    } else if (incoming && Array.isArray(incoming.items) && Array.isArray(incoming.notes)){
      items = incoming.items;
      notes = incoming.notes.map(n=>({
        id: n.id,
        title: n.title || '',
        description: n.description || '',
        links: Array.isArray(n.links) ? n.links : (n.link ? [n.link] : []),
        body: n.body || n.text || '',
        tags: n.tags || [],
        taskId: n.taskId || null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
      messages = Array.isArray(incoming.messages) ? incoming.messages : [];
      passwords = Array.isArray(incoming.passwords) ? incoming.passwords : [];
    } else {
      throw new Error('invalid format');
    }
    messages.sort((a,b)=> new Date(b.date+' '+b.time) - new Date(a.date+' '+a.time));
    saveItems(items); saveNotes(notes); saveMessages(messages); savePasswords(passwords);
    println('imported.', 'ok');
  }catch(e){
    println('import failed: ' + e.message, 'error');
  }
};

cmd.importshare = async ()=>{
  println('Paste shared JSON and press Enter. Type CANCEL to abort.', 'muted');
  const text = await getNextLine();
  if (text.trim().toLowerCase() === 'cancel'){ println('import canceled.','muted'); return; }
  try{
    const payload = JSON.parse(text);
    if (!payload || !payload.enc || !payload.type) throw new Error('invalid format');
    println('Enter share passcode:', 'muted');
    const pass = await getNextLine(true);
    const { decryptShared } = await loadEncryption();
    const obj = await decryptShared(payload.enc, pass);
    if (payload.type === 'item'){
      if (!obj.id || items.some(t=>t.id===obj.id)) obj.id = makeId();
      items.push(obj); saveItems(items);
    } else if (payload.type === 'note'){
      if (!obj.id || notes.some(n=>n.id===obj.id)) obj.id = makeId();
      notes.push(obj); saveNotes(notes);
    } else if (payload.type === 'message'){
      if (!obj.id || messages.some(m=>m.id===obj.id)) obj.id = makeId();
      messages.push(obj);
      messages.sort((a,b)=> new Date(b.date+' '+b.time) - new Date(a.date+' '+a.time));
      saveMessages(messages);
    } else {
      throw new Error('unknown type');
    }
    println('imported.', 'ok');
  }catch(e){
    println('import failed: ' + e.message, 'error');
  }
}; 
cmd.wipe = ()=> openModal();

cmd.genpass = async (args = []) => {
  let words = 8;
  let sep = ' ';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--words' || a === '-w') {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n > 0) { words = n; }
      i++;
    } else if (a === '--sep' || a === '-s') {
      if (args[i + 1] !== undefined) sep = args[i + 1];
      i++;
    }
  }
  const list = await loadDicewareWords();
  const out = [];
  const buf = new Uint16Array(1);
  while (out.length < words) {
    crypto.getRandomValues(buf);
    const idx = buf[0] & 0x1fff;
    if (idx < list.length) out.push(list[idx]);
  }
  println(out.join(sep));
};

cmd.setpass = async ()=>{
  if (locked){ println('unlock first', 'error'); return; }
  println('Enter new passcode:', 'muted');
  const pass = await getNextLine(true);
  if (!pass){
    println('passcode required.', 'error');
    return;
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  passSalt = b64(saltBytes);
  const { deriveKey, DEFAULT_SCRYPT_PARAMS } = await loadEncryption();
  passParams = { ...DEFAULT_SCRYPT_PARAMS };
  passKey = await deriveKey(pass, saltBytes, passParams);
  await saveState(state);
  println('passcode set.', 'ok');
};

cmd.lock = ()=>{
  if (locked){ println('already locked','muted'); return; }
  if (!passSalt){ println('no passcode set','error'); return; }
  stopInactivityTimer();
  items = []; notes = []; messages = [];
  passwords = [];
  state.items = items; state.notes = notes; state.messages = messages; state.passwords = passwords;
  passKey = null;
  locked = true;
  lastTaskListCache = null; lastNoteListCache = null;
  localStorage.removeItem(HISTORY_KEY);
  history = [];
  historyIndex = 0;
  println('locked.', 'ok');
  setTimeout(() => location.reload(), 0);
};

cmd.unlock = async ()=>{
  if (!locked){ println('not locked','muted'); return; }
  const raw = localStorage.getItem(STORE_KEY_V2);
  if (!raw){ println('nothing to unlock','error'); return; }
  try{
    const obj = JSON.parse(raw);
    if (!obj.enc){ println('no passcode set','error'); return; }
    println('Enter passcode:', 'muted');
    const pass = await getNextLine(true);
    const saltBytes = b64ToBuf(obj.enc.salt);
    const { deriveKey, DEFAULT_SCRYPT_PARAMS } = await loadEncryption();
    const params = (obj.enc.kdf && obj.enc.kdf.name === 'scrypt')
      ? { N: obj.enc.kdf.N, r: obj.enc.kdf.r, p: obj.enc.kdf.p }
      : DEFAULT_SCRYPT_PARAMS;
    const key = await deriveKey(pass, saltBytes, params);
    const iv = b64ToBuf(obj.enc.iv);
    const data = b64ToBuf(obj.enc.data);
    const buf = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data);
    const decoded = JSON.parse(dec.decode(new Uint8Array(buf)));
    if (decoded && Array.isArray(decoded.items) && Array.isArray(decoded.notes)){
      state = {
        items: decoded.items,
        notes: decoded.notes,
        messages: Array.isArray(decoded.messages) ? decoded.messages : [],
        passwords: Array.isArray(decoded.passwords) ? decoded.passwords : []
      };
      items = state.items;
      notes = state.notes;
      messages = state.messages;
      passwords = state.passwords;
      passKey = key;
      passSalt = obj.enc.salt;
      passParams = params;
      locked = false;
      println('unlocked.', 'ok');
      startInactivityTimer();
    } else {
      throw new Error('bad data');
    }
  }catch(e){ println('unlock failed','error'); }
};

/************
 * COMMAND LOOP
 ************/
function parseAndRun(raw){
  const line = raw.trim();
  if (!line) return;
  println('> ' + line);
  history.push(line);
  historyIndex = history.length;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  const parts = line.split(/\s+/);
  const name = parts.shift().toLowerCase();
  const args = parts;
  const fn = cmd[name];
  if (!fn){ println('unknown command. type HELP.', 'error'); return; }
  if (locked && !['unlock','help','clear'].includes(name)){
    println('data locked. type UNLOCK.', 'error');
    return;
  }
  Promise.resolve(fn(args)).catch(err=>println('error: '+err.message,'error'));
}
function getNextLine(mask = false){
  awaitingLine = true;
  if (mask) command.type = 'password';
  return new Promise(resolve => {
    function handler(e){
      if (e.key === 'Enter'){
        const val = command.value;
        println('> ' + (mask ? '*'.repeat(val.length) : val));
        command.value = '';
        command.type = 'text';
        command.removeEventListener('keydown', handler);
        awaitingLine = false;
        resolve(val);
      }
    }
    command.addEventListener('keydown', handler);
  });
}
command.addEventListener('keydown', (e)=>{
  if (!awaitingLine && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    if (e.key === 'ArrowUp'){
      if (historyIndex > 0) historyIndex--;
    } else {
      if (historyIndex < history.length) historyIndex++;
    }
    command.value = history[historyIndex] || '';
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter'){
    if (awaitingLine) return;
    const v = command.value;
    command.value='';
    parseAndRun(v);
  }
});

/************
 * MODAL
 ************/
function openModal(){ modal.style.display='flex'; }
function closeModal(){ modal.style.display='none'; }
btnCancel.addEventListener('click', closeModal);
btnOK.addEventListener('click', ()=>{
  items = []; notes = []; messages = [];
  saveItems(items); saveNotes(notes); saveMessages(messages);
  closeModal();
  println('All data wiped.','ok');
});

function showNoteModal(note){
  editingNote = note || null;
  noteModalTitle.textContent = note ? 'Edit Note' : 'Add Note';
  noteTitleInput.value = note ? (note.title || '') : '';
  noteDescriptionInput.value = note ? (note.description || '') : '';
  noteLinksInput.value = note ? ((note.links || []).join(', ')) : '';
  noteAttachmentsInput.value = note ? ((note.attachments || []).filter(a=>!a.startsWith('idb:')).join(', ')) : '';
  noteAttachmentsPreview.innerHTML = '';
  noteAttachmentsFiles.value = '';
  pendingAttachmentFiles = [];
  noteBodyInput.value = note ? (note.body || '') : '';
  noteModal.style.display = 'flex';
  noteTitleInput.focus();
}
function hideNoteModal(){
  noteModal.style.display = 'none';
  editingNote = null;
  noteAttachmentsPreview.innerHTML = '';
  noteAttachmentsFiles.value = '';
  pendingAttachmentFiles = [];
}
function showMessageModal(prefill){
  replyingMessage = prefill || null;
  msgModalTitle.textContent = prefill ? 'Reply Message' : 'Send Message';
  msgFromInput.value = prefill ? (prefill.to || '') : '';
  msgToInput.value = prefill ? (prefill.from || '') : '';
  msgSubjectInput.value = prefill ? (prefill.subject || '') : '';
  const now = new Date();
  msgDateInput.value = now.toISOString().slice(0,10);
  msgTimeInput.value = now.toTimeString().slice(0,5);
  msgBodyInput.value = prefill ? (prefill.message || '') : '';
  msgPassInput.value = '';
  msgModal.style.display = 'flex';
  msgFromInput.focus();
}
function hideMessageModal(){
  msgModal.style.display = 'none';
  replyingMessage = null;
}
msgCancel.addEventListener('click', hideMessageModal);
msgShare.addEventListener('click', async ()=>{
  const from = msgFromInput.value.trim();
  const to = msgToInput.value.trim();
  const subject = msgSubjectInput.value.trim();
  const date = msgDateInput.value;
  const time = msgTimeInput.value;
  const body = msgBodyInput.value.trim();
  const pass = msgPassInput.value.trim();
  if (!from || !to || !pass){
    println('from, to, and passcode required','error');
    return;
  }
  const m = { id: makeId(), from, to, subject, date, time, message: body };
  const idx = messages.findIndex(x=>x.id===m.id);
  if (idx>=0) messages[idx]=m; else messages.push(m);
  messages.sort((a,b)=> new Date(b.date+' '+b.time) - new Date(a.date+' '+a.time));
  saveMessages(messages);
  hideMessageModal();
  const { encryptForShare } = await loadEncryption();
  const encPayload = await encryptForShare(m, pass);
  const payload = { version:1, type:'message', enc: encPayload };
  const json = JSON.stringify(payload);
  if (navigator.share){
    try { await navigator.share({ text: json }); println('shared.','ok'); }
    catch(e){ println('share canceled.','muted'); }
  } else {
    println(json, 'muted');
  }
});
function showPassModal(pass){
  editingPass = pass || null;
  passModalTitle.textContent = pass ? 'Edit Password' : 'Add Password';
  passTitleInput.value = pass ? (pass.title || '') : '';
  passUsernameInput.value = pass ? (pass.username || '') : '';
  passPasswordInput.value = pass ? (pass.password || '') : '';
  passWebsiteInput.value = pass ? (pass.website || '') : '';
  passNotesInput.value = pass ? (pass.notes || '') : '';
  passModal.style.display = 'flex';
  passTitleInput.focus();
}
function hidePassModal(){
  passModal.style.display = 'none';
  editingPass = null;
}
passCancel.addEventListener('click', hidePassModal);
passSave.addEventListener('click', ()=>{
  const title = passTitleInput.value.trim();
  const username = passUsernameInput.value.trim();
  const password = passPasswordInput.value.trim();
  if (!title || !username || !password){
    println('title, username, and password required','error');
    return;
  }
  let website = passWebsiteInput.value.trim();
  if (website && !isSafeUrl(website)){
    console.warn('Skipping unsafe website URL:', website);
    website = '';
  }
  const notesField = passNotesInput.value.trim();
  if (editingPass){
    editingPass.title = title;
    editingPass.username = username;
    editingPass.password = password;
    editingPass.website = website;
    editingPass.notes = notesField;
    println('password edited.','ok');
    printPassword(editingPass);
  } else {
    const p = { id: makeId(), title, username, password, website, notes: notesField };
    passwords.push(p);
    println('password added.','ok');
    printPassword(p);
  }
  savePasswords(passwords);
  hidePassModal();
});
function showPicModal(url){
  currentPicUrl = url;
  picModalImg.src = url;
  picModal.style.display = 'flex';
}
function hidePicModal(){
  picModal.style.display = 'none';
  picModalImg.src = '';
  if (currentPicUrl.startsWith('blob:')) URL.revokeObjectURL(currentPicUrl);
  currentPicUrl = '';
}
picClose.addEventListener('click', hidePicModal);
noteCancel.addEventListener('click', hideNoteModal);
noteSave.addEventListener('click', async ()=>{
  const title = noteTitleInput.value.trim();
  const description = noteDescriptionInput.value.trim();
  if (!title || !description){
    println('title and description required','error');
    return;
  }
  const links = noteLinksInput.value.split(',').map(s=>s.trim()).filter(u=>{
    if (isSafeUrl(u)) return true;
    console.warn('Skipping unsafe link:', u);
    return false;
  });
  let attachments = noteAttachmentsInput.value.split(',').map(s=>s.trim()).filter(u=>{
    if (isSafeUrl(u)) return true;
    console.warn('Skipping unsafe attachment URL:', u);
    return false;
  });
  if (editingNote){
    const existing = (editingNote.attachments || []).filter(a=>a.startsWith('idb:'));
    attachments = existing.concat(attachments);
  }
  for (const entry of pendingAttachmentFiles){
    let processed = entry.file;
    try {
      processed = await stripImageMetadata(entry.file);
    } catch (e) {
      console.warn('Failed to strip metadata', e);
    }
    let ref = await storeImageBlob(processed);
    if (ref) attachments.push('idb:'+ref);
    else if (entry.dataUrl) attachments.push(entry.dataUrl);
  }
  const body = noteBodyInput.value.trim();
  if (editingNote){
    editingNote.title = title;
    editingNote.description = description;
    editingNote.links = links;
    editingNote.attachments = attachments;
    editingNote.body = body;
    editingNote.updatedAt = Date.now();
    println('note edited.','ok');
    printNote(editingNote);
  }else{
    const n = { id: makeId(), title, description, links, attachments, body, tags:[], taskId:null, createdAt:Date.now(), updatedAt:Date.now() };
    notes.push(n);
    println('note added.','ok');
    printNote(n);
  }
  saveNotes(notes);
  hideNoteModal();
});

/************
 * PWA INSTALL FLOW
 ************/
const installBtn = document.getElementById('installBtn');
const installStatus = document.getElementById('installStatus');
const installHelp = document.getElementById('install-help');
const installClose = document.getElementById('install-close');
let deferredPrompt = null;

function setStatus(s){ if (installStatus) installStatus.textContent = s; }

// Register SW and wait until it's controlling the page
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      swRegistration = reg;
      setStatus('Ready');
      rescheduleAllNotifications();
    })
    .catch(err => setStatus('SW error'));
} else {
  setStatus('No SW support');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.add('enabled');
  installBtn.disabled = false;
  setStatus('Install ready');
});

installBtn.addEventListener('click', async () => {
  // Already installed?
  if (window.matchMedia('(display-mode: standalone)').matches) {
    setStatus('Already installed');
    return;
  }
  if (deferredPrompt) {
    installBtn.disabled = true;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.disabled = false;
    installBtn.classList.remove('enabled');
    setStatus(outcome === 'accepted' ? 'Installed' : 'Dismissed');
  } else {
    // Fallback help (we cannot force install if browser doesn't expose the prompt)
    installHelp.style.display = 'flex';
  }
});

installClose.addEventListener('click', () => {
  installHelp.style.display = 'none';
});

window.addEventListener('appinstalled', () => {
  setStatus('Installed');
  deferredPrompt = null;
  installBtn.classList.remove('enabled');
});


/************
 * VIEWPORT PINNING
 ************/
(function pinBottom(){
  const vv = window.visualViewport;
  if (!vv) return;
  function reposition(){
    const inputBar = document.getElementById('input-bar');
    const obscured = Math.max(0, (window.innerHeight - (vv.height + vv.offsetTop)));
    inputBar.style.transform = 'translateY(' + (-obscured) + 'px)';
    const inputH = inputBar.getBoundingClientRect().height;
    output.style.bottom = 'calc(' + inputH + 'px + env(safe-area-inset-bottom) + ' + obscured + 'px)';
  }
  vv.addEventListener('resize', reposition);
  vv.addEventListener('scroll', reposition);
  window.addEventListener('orientationchange', ()=>setTimeout(reposition, 50));
  window.addEventListener('resize', reposition);
  window.requestAnimationFrame(reposition);
})();

// Initial greeting
if (!localStorage.getItem('terminal-list-initialized-v4')){
  println('Welcome to Terminal List.');
  println('Type HELP for tasks, notes, and messages commands.');
  localStorage.setItem('terminal-list-initialized-v4','1');
}
if (!passSalt) println('No passcode set. Use SETPASS to protect stored data. Saving disabled until a passcode is set.', 'error');
if (locked) println('Data is locked. Type UNLOCK to access.', 'muted');

if (!locked) startInactivityTimer();

// Focus on output tap
output.addEventListener('pointerdown', ()=>command.focus());

export { cmd };
