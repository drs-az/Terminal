# Terminal List

**Terminal List** is a browser-based Progressive Web App (PWA) for managing tasks, notes and messages in a terminal-style interface.
It requires a passcode before storing any data and encrypts everything with AES-256-GCM. The app also supports JSON export/import, due-date notifications, customizable themes, and an emergency data wipe function.

## Features

- ✅ **Tasks**: Add items, tag them, set priorities or due dates, and search.
- 📝 **Notes**: Create standalone notes or link them to tasks, and tag them.
- 🔐 **Passcode Lock**: Protect your data with AES-256-GCM encryption (keys derived with scrypt). Saving is blocked until you set a passcode.
- ⏰ **Due-date Notifications**: Receive reminders for tasks on their due date (requires notification permission).
- 🎨 **Custom Themes**: Adjust terminal colors with the `THEME` command.
- 📤 **Export/Import**: Backup or restore tasks, notes, and messages in JSON format.
- 🚨 **Emergency Wipe**: One command securely wipes all local data.
- 📱 **PWA Support**: Installable, offline-capable, works across desktop and mobile.
- 🔁 **Recurring & Snoozeable Reminders**: Automatically reschedule tasks or snooze them to a later date.
- 🔎 **Advanced Queries**: Filter tasks by tag, due date (including overdue), completion state, or priority.
- ✨ **Rich Note Editing**: Add attachments, links, or formatted text to notes.
- ☁️ **Cloud Backup**: Encrypted sync to a localStorage sandbox or Google Drive using your passcode.
- 🎭 **Theme Presets**: Apply or export theme JSON files for easy sharing.
- 🤝 **Collaboration Channel**: Share encrypted task and note data with other tabs via BroadcastChannel using a shared secret.
- ✉️ **Messages**: Compose, share, and receive encrypted messages.
- 📎 **Encrypted Sharing**: Share individual tasks, notes, or messages with a passcode-protected payload.

## Project Structure

```
Terminal-List/
 ├── index.html              # PWA shell and UI
 ├── app.js                  # Core application logic
 ├── features.js             # Feature helpers (recurring reminders, cloud sync, etc.)
 ├── collaboration.js        # Encrypted BroadcastChannel syncing
 ├── encryption.js           # AES-256-GCM helpers
 ├── sanitize.js             # Minimal HTML sanitizer
 ├── build-manifest.js       # Generates asset manifest and config.json
 ├── asset-manifest.js       # Generated list of cached assets
 ├── manifest.webmanifest    # PWA manifest file
 ├── sw.js                   # Service worker for offline support
 ├── config.template.json    # Template for runtime config (copy to config.json)
 └── icons/                  # App icons
      ├── icon-192.png
      └── icon-512.png
```

## Build

Generate the asset manifest, runtime config, and cache version before deployment:

```bash
GDRIVE_CLIENT_ID=<your_client_id> \
GDRIVE_API_KEY=<your_api_key> \
node build-manifest.js
```

`build-manifest.js` hashes core assets, writes `asset-manifest.js`, and creates a `config.json` file using the `GDRIVE_CLIENT_ID` and `GDRIVE_API_KEY` environment variables. The service worker uses the manifest's version for cache busting.

`config.json` is ignored by Git; see `config.template.json` for the expected structure. The app fetches this file at runtime to supply Google Drive credentials to `setGDriveCredentials`.

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
- `list [all|open|done|@tag]` — list items; when using `@tag` notes are also shown
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
- `share <id|#>` — share a task encrypted with a passcode

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
- `ntag <id|#> +foo -bar` — add/remove tags
- `nsearch <query>` — find text in notes
- `nshare <id|#>` — share a note encrypted with a passcode

### Messages
- `msgs` — list messages
- `sendmsg` — compose and share an encrypted message
- `recmsg` — paste shared message JSON and decrypt with a passcode
- `readmsg <id|#>` — read a message
- `replymsg <id|#>` — reply to a message
- `delmsg <id|#>` — delete a message

### Security & Data
- `stats` — summary counts
- `clear` — clear the display
- `export` — download JSON (tasks + notes + messages)
- `import` — paste JSON to replace all data
- `importshare` — paste shared item JSON and decrypt with a passcode
- `wipe` — clear all data (with confirm)
- `genpass [-w <n>] [-s <sep>]` — generate a Diceware passphrase (default: 8 words, space-separated)
- `setpass` — set passcode
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
- `backup [provider] [upload|download]` — passcode-encrypted sync to a sandbox provider (`local` or `gdrive`)
- `gdriveconfig <client_id> <api_key>` — store Google Drive credentials for backup
- `themepreset <json>` — apply a theme preset from JSON
- `themeexport [name]` — download current theme preset
- `collab <session>` — join a collaboration channel and broadcast tasks/notes

## Feature Helpers

Experimental helpers live in `features.js` and are exported as named functions. Import the helpers you need in your own scripts or from the browser console using `import('./features.js')`.

### Recurring & Snoozeable Reminders
```js
import { scheduleRecurringReminder, snoozeReminder } from './features.js';
scheduleRecurringReminder(taskId, { every: 1, unit: 'day' });
snoozeReminder(taskId, '2024-05-20');
```

### Advanced Queries
```js
import { parseAdvancedQuery } from './features.js';
// returns matching task IDs
parseAdvancedQuery('tag:work pri:H due:overdue done:false');
```

### Rich Note Editing
```js
import { editNoteRich } from './features.js';
editNoteRich(noteId, {
  title: 'Updated note',
  attachments: ['https://example.com/file.png'],
  links: ['note:2']
});
```

### Cloud Backup
Backups are encrypted with your passcode.
```js
import { syncWithCloud } from './features.js';
await syncWithCloud('local', 'upload', passcode);   // save encrypted backup to localStorage sandbox
await syncWithCloud('local', 'download', passcode); // restore from sandbox
```

### Google Drive Backup
`clientId` and `apiKey` are read from `config.json` at startup. To supply them manually, run inside the app:
```
GDRIVECONFIG <client_id> <api_key>
```
> Credentials are held only for the current session and are not saved to storage. Re-enter them after each reload and keep these keys private.
Then:
```js
import { syncWithCloud } from './features.js';
await syncWithCloud('gdrive', 'upload', passcode);
await syncWithCloud('gdrive', 'download', passcode);
```

### Theme Presets
```js
import { applyThemePreset, exportThemePreset } from './features.js';
applyThemePreset({ bg:'#000', fg:'#0f0', border:'#0f0' });
exportThemePreset('my-theme'); // downloads my-theme.json
```

### Collaboration Channel
```js
import { startCollaboration } from './collaboration.js';
const collab = startCollaboration('session1', 'shared-secret');
await collab.broadcast(); // sync current tasks/notes to other tabs with same session and secret
```

## Security Notes

- On startup, the app blocks saving until you set a passcode with `setpass`.
- Without a passcode, data cannot be stored in browser localStorage.
- If a passcode is set, all data is encrypted at rest using AES-256-GCM.
 - Passcode derivation uses scrypt with configurable parameters (stored with
   your data so the cost can be increased in future versions).
- Remember your passcode! Without it, encrypted data cannot be recovered.
- Google Drive credentials configured via `GDRIVECONFIG` live only in memory; never commit API keys or share them publicly.
- When updating the Google API script, recompute its Subresource Integrity hash using:
  `curl -s https://apis.google.com/js/api.js | openssl dgst -sha384 -binary | openssl base64 -A`
  and replace the `integrity` value in `index.html`.

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
