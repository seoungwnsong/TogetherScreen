# Architecture

```text
React website ───────────────┐
                             │ Socket.IO
Chrome extension background ├──────────────► Node.js server
                             │                  ├─ rooms
Content script ◄─────────────┘                  ├─ ready state
  └─ controls the active HTML5 video            ├─ chat history
                                                └─ playback state
```

## Web app

The Vite/React client creates and joins rooms, displays participants, handles chat, and synchronizes its demo video.

## Chrome extension

- `popup.js` manages the extension interface.
- `background.js` owns the Socket.IO connection and room state.
- `content.js` finds the largest visible HTML5 `<video>` and applies playback commands.
- `config.js` stores the backend and website URLs.

## Server

The Node.js server uses Express for health endpoints and Socket.IO for live room events. Rooms are stored in memory, so they reset whenever the server restarts.
