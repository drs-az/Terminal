# Terminal List

**Terminal List** is a browser-based Progressive Web App (PWA) for managing tasks and notes in a terminal-style interface.
It supports optional passcode protection with AES-256 encryption, JSON export/import, and an emergency data wipe function.

## Features

- ✅ **Tasks**: Add items, tag them, set priorities or due dates, and search.
- 📝 **Notes**: Create standalone notes or link them to tasks.
- 🔐 **Passcode Lock**: Protect your data with AES-256-GCM encryption (derived with PBKDF2).
- 📤 **Export/Import**: Backup or restore tasks and notes in JSON format.
- 🚨 **Emergency Wipe**: One command securely wipes all local data.
- 📱 **PWA Support**: Installable, offline-capable, works across desktop and mobile.

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
- `due <id|#> <YYYY-MM-DD>` — set due date (or "clear")
- `priority <id|#> <H|M|L>` — set priority
- `search <query>` — find text in items

### Notes
- `note <text>` — add a note
- `notes [all|@tag|task:<ref>]` — list notes
- `nedit <id|#> <text>` — edit a note
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

## Security Notes

- If no passcode is set, data is saved in browser localStorage unencrypted.  
- If a passcode is set, all data is encrypted at rest using AES-256-GCM.  
- Passcode derivation uses PBKDF2 with 200k iterations.  
- Remember your passcode! Without it, encrypted data cannot be recovered.

## License

This project is provided as-is, with no warranty.  
All data is stored locally in your browser and under your control.
