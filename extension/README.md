# TogetherScreen Chrome extension

The extension uses a local Socket.IO browser bundle because Manifest V3 extensions cannot load remote JavaScript.

To set up the extension, run:

```bash
npm install
npm run setup:extension
```

Make sure it creates:

```text
extension/socket.io.min.js
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension` folder.

To connect to an online backend, update `config.js` and replace the localhost server address with your Render service URL.
