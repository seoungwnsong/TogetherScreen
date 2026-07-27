# TogetherScreen

TogetherScreen is a real-time watch-party project that synchronizes HTML5 video playback across different browsers. It includes a React website, a Chrome extension, and a Node.js/Socket.IO backend.

## Features

- Private room creation and joining
- Host and viewer roles
- Ready checks and synchronized countdowns
- Play, pause, seek, and playback drift correction
- YouTube and standard HTML5 video detection through the Chrome extension
- Live participant status and chat in the web app
- Reconnection and host transfer

## Project structure

```text
TogetherScreen/
├── .github/workflows/ci.yml
├── docs/
│   ├── ARCHITECTURE.md
│   └── TESTING.md
├── extension/
│   ├── icons/
│   ├── scripts/vendor-socketio.mjs
│   ├── background.js
│   ├── config.js
│   ├── content.js
│   ├── manifest.json
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── server/
│   ├── .env.example
│   ├── index.js
│   └── package.json
├── web/
│   ├── public/extension-test.html
│   ├── src/
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
├── .gitignore
├── package.json
└── render.yaml
```

## Local development

### Requirements

- Node.js 20 or newer
- npm
- Google Chrome

### Install

From the repository root:

```bash
npm install
npm run setup:extension
```

The second command copies the installed Socket.IO browser client into the extension folder.

### Run the backend

```bash
npm run dev:server
```

The server runs at `http://localhost:3001`.

### Run the website

In another terminal:

```bash
npm run dev:web
```

The website runs at `http://localhost:5173`.

### Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension` folder.
5. Open a YouTube page or `http://localhost:5173/extension-test.html`.

## Environment configuration

Copy the example files when local overrides are needed:

```bash
cp server/.env.example server/.env
cp web/.env.example web/.env
```

Do not commit `.env` files.

## Deploy the backend to Render

The included `render.yaml` can create the backend as a Render Blueprint.

After Render provides the public service address, update `extension/config.js`:

```js
SERVER_URL: "https://YOUR-SERVICE.onrender.com"
```

Reload the extension on both computers after changing the address.

The backend health check is:

```text
https://YOUR-SERVICE.onrender.com/health
```

## Deploy the website

The `web` folder is ready for a Vite deployment. Set this environment variable on the hosting platform:

```text
VITE_SERVER_URL=https://YOUR-SERVICE.onrender.com
```

Then add the deployed website origin to the server's `CLIENT_URLS` environment variable.

## Testing

See [`docs/TESTING.md`](docs/TESTING.md) for the two-profile and two-computer test checklist.

## Current limitations

- Room state is kept in server memory and resets when the backend restarts.
- The extension targets visible HTML5 video elements; some protected streaming platforms may need platform-specific support.
- A participant currently leaves the room to stop syncing. Independent watch mode is planned as the next feature.
