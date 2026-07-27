# TogetherScreen Chrome extension

The extension uses a local Socket.IO browser bundle because Manifest V3 extension pages cannot load remote JavaScript.

From the repository root, run:

```bash
npm install
npm run setup:extension
```

That creates:

```text
extension/socket.io.min.js
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension` folder.

Before using the deployed backend, edit `config.js` and replace the localhost server address with your Render service URL.
