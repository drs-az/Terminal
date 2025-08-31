# Terminal List

**Terminal List** is a browser-based Progressive Web App (PWA) for managing tasks and notes in a terminal-style interface.
It supports optional passcode protection with AES-256 encryption, JSON export/import, due-date notifications, customizable themes, and an emergency data wipe function.

## Features

- ✅ **Tasks**: Add items, tag them, set priorities or due dates, and search.
- 📝 **Notes**: Create standalone notes or link them to tasks.
- 🔐 **Passcode Lock**: Protect your data with AES-256-GCM encryption (derived with PBKDF2).
- ⏰ **Due-date Notifications**: Receive reminders for tasks on their due date (requires notification permission).
- 🎨 **Custom Themes**: Adjust terminal colors with the `THEME` command.
- 📤 **Export/Import**: Backup or restore tasks and notes in JSON format.
- 🚨 **Emergency Wipe**: One command securely wipes all local data.
- 📱 **PWA Support**: Installable, offline-capable, works across desktop and mobile.
- 🔁 **Recurring & Snoozeable Reminders**: Automatically reschedule tasks or snooze them to a later date.
- 🔎 **Advanced Queries**: Filter tasks by tag, due date (including overdue), completion state, or priority.
- ✨ **Rich Note Editing**: Add attachments, links, or formatted text to notes.
- ☁️ **Cloud Backup**: Upload or download data to a localStorage sandbox or Google Drive.
- 🎭 **Theme Presets**: Apply or export theme JSON files for easy sharing.
- 🤝 **Collaboration Channel**: Share task and note data with other tabs via BroadcastChannel.

## Project Structure

```
TerminalList_PWA/
 ├── index.html              # Main app UI and logic
 ├── manifest.webmanifest    # PWA manifest file
 ├── sw.js                   # Service worker for offline support
 └── icons/                  # App icons
      ├── icon-192.png
      └── icon-512.png
```

## Installation / Running

You can run the app in two ways:

### 1. Quick Start (local only, no PWA install)
Open `index.html` in your browser.  
⚠️ Limitation: Offline caching and install-to-home-screen features will not work this way.

### 2. Recommended: Local Server (full PWA support)

Run a local static server from the project folder:

**Python 3**
```bash
python -m http.server 8080
```
**Node.js**
```bash
npx serve
```

Then visit: [http://localhost:8080](http://localhost:8080)

Your browser will prompt you to install the PWA for a native-like experience.

### 3. Hosting
You can host the files on GitHub Pages, Netlify, Vercel, or any static web server.  
Once hosted over HTTPS, you can install Terminal List on multiple devices.

## Commands

Type commands into the input bar or directly in the terminal view.

### Tasks
- `add <text>` — add a new item
- `list [all|open|done|@tag]` — list items
- `show <id|#>` — show a task with attached notes
- `done <id|#>` — mark done
- `undone <id|#>` — unmark done
- `delete <id|#>` — delete item
- `edit <id|#> <text>` — edit text
- `move <id|#> <up|down|n>` — reorder item
- `tag <id|#> +foo -bar` — add/remove tags
- `due <id|#> <YYYY-MM-DD>` — set due date (notifications fire on the due date; or "clear")
- `priority <id|#> <H|M|L>` — set priority
- `search <query>` — find text in items

### Notes
- `note <title>|<desc>|[link]|[body]` — add a note
- `notes [all|@tag|task:<ref>]` — list notes
- `nedit <id|#> <title>|<desc>|[link]|[body]>` — edit a note
- `readnote <id|#>` — show all fields for a note
- `seepic <id|#>` — open a note's image attachment in a modal
- `dlpic <id|#>` — download a note's image attachment
- `ndelete <id|#>` — delete a note
- `nlink <note|#> <task|#>` — link a note to a task
- `nunlink <note|#>` — unlink note from task
- `nsearch <query>` — find text in notes

### Security & Data
- `stats` — summary counts
- `clear` — clear the display
- `export` — download JSON (tasks + notes)
- `import` — paste JSON to replace all data
- `wipe` — clear all data (with confirm)
- `setpass` — set or clear passcode
- `lock` — clear decrypted data from memory
- `unlock` — restore data with passcode


### Other

- `syntax <command>` — show detailed usage for a command (e.g., `syntax nrich`)
- `theme <bg> <fg> <border>` — set terminal colors

### Experimental Feature Commands

- `recur <id|#> <n> <unit>` — schedule recurring reminder (`unit` = minute|hour|day|week)
- `snooze <id|#> <YYYY-MM-DD>` — snooze a task to a new date
- `aquery <query>` — run an advanced task query (tag/due/done/pri filters; `due:overdue` for past-due tasks)
- `nrich <id|#> <title>|[body]|[link]|[attachments]` — edit note with rich fields; attachments are a comma-separated list of URLs or data URIs
- `backup [provider] [upload|download]` — sync data to a sandbox provider (`local` or `gdrive`)
- `gdriveconfig <client_id> <api_key>` — store Google Drive credentials for backup
- `themepreset <json>` — apply a theme preset from JSON
- `themeexport [name]` — download current theme preset
- `collab <session>` — join a collaboration channel and broadcast tasks/notes

## Feature Helpers

A global `TerminalListFeatures` object exposes experimental helpers. Invoke these from the browser console.

### Recurring & Snoozeable Reminders
```js
TerminalListFeatures.scheduleRecurringReminder(taskId, { every: 1, unit: 'day' });
TerminalListFeatures.snoozeReminder(taskId, '2024-05-20');
```

### Advanced Queries
```js
// returns matching task IDs
TerminalListFeatures.parseAdvancedQuery('tag:work pri:H due:overdue done:false');
```

### Rich Note Editing
```js
TerminalListFeatures.editNoteRich(noteId, {
  title: 'Updated note',
  attachments: ['https://example.com/file.png'],
  links: ['note:2']
});
```

### Cloud Backup
```js
await TerminalListFeatures.syncWithCloud('local', 'upload');   // save to localStorage sandbox
await TerminalListFeatures.syncWithCloud('local', 'download'); // restore from sandbox
```

### Google Drive Backup
Run inside the app:
```
GDRIVECONFIG <client_id> <api_key>
```
Then:
```js
await TerminalListFeatures.syncWithCloud('gdrive', 'upload');
await TerminalListFeatures.syncWithCloud('gdrive', 'download');
```

### Theme Presets
```js
TerminalListFeatures.applyThemePreset({ bg:'#000', fg:'#0f0', border:'#0f0' });
TerminalListFeatures.exportThemePreset('my-theme'); // downloads my-theme.json
```

### Collaboration Channel
```js
const collab = TerminalListFeatures.startCollaboration('session1');
collab.broadcast(); // sync current tasks/notes to other tabs with same session
```

## Security Notes

- If no passcode is set, data is saved in browser localStorage unencrypted.  
- If a passcode is set, all data is encrypted at rest using AES-256-GCM.  
- Passcode derivation uses PBKDF2 with 200k iterations.  
- Remember your passcode! Without it, encrypted data cannot be recovered.

## License

This project is provided as-is, with no warranty.
All data is stored locally in your browser and under your control.

## Manual Testing

To check image attachment support:

1. Open the app in a desktop or mobile browser.
2. Run `NOTE` to open the note modal and select one or more images.
3. Verify thumbnails appear in the modal and can be removed before saving.
4. Save the note and use `NOTES` or `READNOTE` to confirm images render.
5. Delete the note to ensure the images are removed.
