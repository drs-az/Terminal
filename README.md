# Terminal List

**Terminal List** is a browser-based Progressive Web App (PWA) for note-taking and list-making in a terminal-style interface.  
It supports passcode protection with AES-256 encryption, JSON export/import, and an emergency data wipe function.

## Features

- 📝 **Notes**: Create, view, edit, and delete notes via simple commands.
- 📦 **Lists**: Maintain task lists, toggle items as done, and delete lists.
- 🔐 **Passcode Lock**: Protect your data with AES-256-GCM encryption (derived with PBKDF2).
- 📤 **Export/Import**: Backup or transfer notes and lists in JSON format.
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

### Notes
- `notes` — list all notes
- `note "Title"` — create a note
- `open note <id|title>` — view a note
- `write note <id|title> "text"` — append text
- `del note <id|title>` — delete a note

### Lists
- `lists` — list all lists
- `list "Title"` — create a list
- `add <list> "item"` — add an item
- `show <list>` — show items in a list
- `done <list> <itemId>` — toggle an item done/undone
- `del list <id|title>` — delete a list

### Security & Data
- `setpass` — set/replace passcode (AES-256-GCM encryption)
- `lock` — lock the app
- `unlock` — unlock with passcode
- `export` — export data to JSON file
- `import` — import JSON (merge)
- `import replace` — import JSON (replace all data)
- `wipe` — emergency data wipe (confirmation required)

## Security Notes

- If no passcode is set, data is saved in browser localStorage unencrypted.  
- If a passcode is set, all data is encrypted at rest using AES-256-GCM.  
- Passcode derivation uses PBKDF2 with 200k iterations.  
- Remember your passcode! Without it, encrypted data cannot be recovered.

## License

This project is provided as-is, with no warranty.  
All data is stored locally in your browser and under your control.
