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

function parseAdvancedQuery(query) {
  if (!query) return [];
  const tokens = query.trim().split(/\s+/);
  const filters = { tags: [], text: [], due: null, done: null };
  tokens.forEach(tok => {
    if (tok.startsWith('tag:')) filters.tags.push(tok.slice(4));
    else if (tok.startsWith('due:')) filters.due = tok.slice(4);
    else if (tok.startsWith('done:')) filters.done = tok.slice(5) === 'true';
    else filters.text.push(tok.toLowerCase());
  });
  const today = new Date().toISOString().slice(0, 10);
  return (window.items || []).filter(t => {
    if (filters.tags.length && !filters.tags.every(tag => (t.tags || []).includes(tag))) return false;
    if (filters.due) {
      const due = filters.due === 'today' ? today : filters.due;
      if (t.due !== due) return false;
    }
    if (filters.done !== null && t.done !== filters.done) return false;
    if (filters.text.length && !filters.text.every(q => t.text.toLowerCase().includes(q))) return false;
    return true;
  }).map(t => t.id);
}

// --- Rich Note Editing ----------------------------------------------------

function editNoteRich(noteId, options = {}) {
  const note = (window.notes || []).find(n => n.id === noteId);
  if (!note) return null;
  if (options.title !== undefined) note.title = options.title;
  if (options.body !== undefined) note.body = options.body;
  if (options.attachments !== undefined) note.attachments = options.attachments;
  if (options.links !== undefined) note.links = options.links;
  if (typeof saveNotes === 'function') saveNotes(notes);
  return note;
}

// --- Cloud Backup / Sync --------------------------------------------------

function syncWithCloud(provider = 'local', mode = 'upload') {
  const key = `terminal-list-sync-${provider}`;
  if (mode === 'upload') {
    const data = JSON.stringify({ items: window.items || [], notes: window.notes || [] });
    localStorage.setItem(key, data);
    return Promise.resolve('uploaded');
  } else {
    const raw = localStorage.getItem(key);
    if (!raw) return Promise.reject('no-data');
    const data = JSON.parse(raw);
    window.items = data.items || [];
    window.notes = data.notes || [];
    if (typeof saveItems === 'function') saveItems(window.items);
    if (typeof saveNotes === 'function') saveNotes(window.notes);
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

function startCollaboration(sessionId) {
  const channel = new BroadcastChannel(`tl-collab-${sessionId}`);
  channel.onmessage = e => {
    if (e.data && e.data.items && e.data.notes) {
      window.items = e.data.items;
      window.notes = e.data.notes;
      if (typeof saveItems === 'function') saveItems(window.items);
      if (typeof saveNotes === 'function') saveNotes(window.notes);
      if (typeof rescheduleAllNotifications === 'function') rescheduleAllNotifications();
    }
  };
  function broadcast() {
    channel.postMessage({ items: window.items || [], notes: window.notes || [] });
  }
  return { channel, broadcast };
}

// Expose features for external use
window.TerminalListFeatures = {
  scheduleRecurringReminder,
  snoozeReminder,
  parseAdvancedQuery,
  editNoteRich,
  syncWithCloud,
  applyThemePreset,
  exportThemePreset,
  startCollaboration
};

