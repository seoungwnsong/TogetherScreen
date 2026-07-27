# Testing checklist

## Local setup

Run the server and website in separate terminals:

```bash
npm run dev:server
npm run dev:web
```

Open:

```text
http://localhost:5173/extension-test.html
```

Load the extension from `chrome://extensions` after running `npm run setup:extension`.

## Two-user test

Use two separate Chrome profiles.

1. Profile A creates a room and remains host.
2. Profile B joins the same room and appears as viewer.
3. Both click Ready.
4. The host clicks Start Together.
5. Confirm the countdown appears in both tabs.
6. Test play, pause, and seek from the host.
7. Refresh one video tab and confirm reconnection.
8. Switch to another YouTube video and rescan.
9. Have the host leave and confirm host transfer.

## Deployment test

1. Open the Render `/health` endpoint.
2. Install the extension on two different computers.
3. Confirm both extensions show Connected.
4. Join the same room from different networks.
5. Run the play, pause, seek, refresh, and host-transfer tests again.
