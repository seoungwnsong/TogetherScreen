# TogetherScreen

TogetherScreen is a web app and Chrome extension that allows people to watch videos together while staying on the same timeline.

I originally started this project because I wanted a simple way to watch videos with my girlfriend while we were in different countries. With TogetherScreen, users can create a private room, join using the same room code, and synchronize their videos in real time.

## Features

- Create and join private rooms
- Detect YouTube and standard HTML5 videos
- Start videos together with a synchronized countdown
- Synchronize play, pause, and seek
- Show host, viewer, and ready status
- Automatically transfer the host when the current host leaves
- Correct playback differences between users
- Reconnect users after refreshing the page

## How It Works

When the host plays, pauses, or changes the video timeline, the Chrome extension detects the action and sends it to the TogetherScreen server.

The server then sends the update to everyone else in the same room.

```text
Host's video
     ↓
Chrome extension
     ↓
Socket.IO server
     ↓
Other participants
     ↓
Their videos update
```

Socket.IO is used to maintain real-time communication between the users and the server.

## Technologies Used

- React
- Vite
- JavaScript
- Node.js
- Express
- Socket.IO
- Chrome Extension Manifest V3

## Running the Project Locally

### Requirements

- Node.js
- npm
- Google Chrome

### Install Dependencies

From the main project folder, run:

```bash
npm install
npm run setup:extension
```

The second command adds the Socket.IO browser client to the Chrome extension.

### Start the Backend

```bash
npm run dev:server
```

The backend will run at:

```text
http://localhost:3001
```

### Start the Website

Open another terminal and run:

```bash
npm run dev:web
```

The website will run at:

```text
http://localhost:5173
```

## Loading the Chrome Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension` folder.
6. Open a YouTube video.
7. Open the TogetherScreen extension.

For testing with two users, use two separate Chrome profiles and load the extension in both profiles.

## Testing

### Create a Room

1. Open a YouTube video.
2. Open the extension.
3. Enter your name.
4. Create a room.
5. Copy the room code.

### Join a Room

1. Open another Chrome profile.
2. Open the same YouTube video.
3. Open the extension.
4. Enter another name.
5. Join using the same room code.

### Start Together

1. Both users click **Ready**.
2. The host clicks **Start Together**.
3. Both videos begin after the synchronized countdown.

The host can then control:

- Play
- Pause
- Seek
- Synchronized playback

## Environment Variables

The local backend can use a `server/.env` file:

```env
PORT=3001
CLIENT_URLS=http://localhost:5173
```

The website can use a `web/.env` file:

```env
VITE_SERVER_URL=http://localhost:3001
```

Do not upload `.env` files to GitHub.

Use `.env.example` files to show which environment variables are required without exposing private information.

## Deployment

The backend can be deployed using Render.

After deployment, update the server address inside:

```text
extension/config.js
```

Change:

```js
SERVER_URL: "http://localhost:3001"
```

to the deployed backend address:

```js
SERVER_URL: "https://your-server-address.onrender.com"
```

Reload the extension after changing the server address.


## Author

Created by Seoungwan Song.