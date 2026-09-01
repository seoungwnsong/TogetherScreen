"use strict";

importScripts("config.js", "socket.io.min.js");

const CONFIG = globalThis.TOGETHER_SCREEN_CONFIG;
const STORAGE_KEY = "togetherScreenExtensionSession";

const state = {
  connected: false,
  connecting: false,
  joined: false,
  roomId: "",
  name: "",
  participantId: "",
  room: null,
  controlledTabId: null,
  video: {
    found: false,
    title: "",
    currentTime: 0,
    duration: 0,
    paused: true,
    url: "",
    followUrl: "",
  },
  error: "",
  lastEvent: "Waiting for a video tab",
};

let socket = null;
let syncTimer = null;
let keepAliveTimer = null;
let lastReportedVideoId = null;
let lastReportedVideoFound = null;
let lastReportedFollowUrl = null;

// Tracks the host's videoId across room-status updates so a genuine host
// video change (A -> B) can be told apart from a first detection, a rescan
// of the same video, or a playback-only update (none of which touch
// videoId). Reset per room session in leaveRoom().
let hostVideoTracking = { known: false, videoId: "" };

// The host videoId that a real "host changed video" transition was most
// recently observed for. Drives the Follow Host prompt's title/message.
let hostChangedToVideoId = "";

// The host videoId the participant has already dismissed/followed the
// prompt for, so it doesn't reappear until the host's video changes again.
let followPromptDismissedFor = "";

// Reports the minimal video-context to the server so other participants can
// tell whether Ready users are watching the same content. Only the host's
// followUrl is ever included — guests never broadcast their own browsing
// URL. Only sends when something actually changed to avoid spamming
// room-status broadcasts.
function maybeReportVideoInfo() {
  if (!state.joined || !socket?.connected) return;

  const videoId = state.video.videoId || "";
  const found = Boolean(state.video.found);
  const followUrl = currentUser()?.isHost ? state.video.followUrl || "" : "";

  if (
    videoId === lastReportedVideoId &&
    found === lastReportedVideoFound &&
    followUrl === lastReportedFollowUrl
  ) {
    return;
  }

  lastReportedVideoId = videoId;
  lastReportedVideoFound = found;
  lastReportedFollowUrl = followUrl;
  socket.emit("video-info", { roomId: state.roomId, videoId, found, followUrl });
}

// Updates hostVideoTracking from the latest room-status and flags a genuine
// host video change (never on first detection or an unchanged/empty video).
function updateHostVideoTracking() {
  const hostUser = state.room?.users?.find((user) => user.isHost);
  const hostVideoId = hostUser?.videoFound ? hostUser.videoId || "" : "";

  if (!hostVideoTracking.known) {
    hostVideoTracking.known = true;
    hostVideoTracking.videoId = hostVideoId;
    return;
  }

  if (
    hostVideoTracking.videoId &&
    hostVideoId &&
    hostVideoId !== hostVideoTracking.videoId
  ) {
    hostChangedToVideoId = hostVideoId;
    // A new host video always gets a fresh chance to prompt, even if the
    // previous one had been dismissed.
    followPromptDismissedFor = "";
  }

  hostVideoTracking.videoId = hostVideoId;
}

// The single shared Follow Host prompt: null when nothing to show, otherwise
// one of the two copy variants from the same underlying mismatch check
// (me vs. the host, Ready participants only).
function computeFollowPrompt() {
  const me = currentUser();
  if (!state.joined || !me?.ready || me.isHost) return null;

  const hostUser = state.room?.users?.find((user) => user.isHost);
  if (!hostUser?.connected) return null;

  const hostVideoId = hostUser.videoFound ? hostUser.videoId || "" : "";
  const hostFollowUrl = hostUser.followUrl || "";
  const myVideoId = state.video.found ? state.video.videoId || "" : "";

  if (!hostVideoId || !myVideoId || hostVideoId === myVideoId || !hostFollowUrl) {
    return null;
  }

  if (followPromptDismissedFor === hostVideoId) return null;

  const isHostChange = hostChangedToVideoId === hostVideoId;

  return {
    isHostChange,
    title: isHostChange ? "HOST CHANGED VIDEO" : "DIFFERENT VIDEO DETECTED",
    message: isHostChange
      ? "Switch to the host's current video?"
      : "The host is watching a different video.",
    followUrl: hostFollowUrl,
  };
}

function makeParticipantId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `extension_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}

function normalizeRoomId(value) {
  return String(value || "")
    .trim()
    .slice(0, 40);
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .slice(0, 30);
}

function currentUser() {
  return state.room?.users?.find(
    (user) => user.participantId === state.participantId
  );
}

function getConnectedUsers() {
  const users = Array.isArray(state.room?.users) ? state.room.users : [];
  return users.filter((user) => user.connected);
}

function isEveryoneReady() {
  const connectedUsers = getConnectedUsers();
  return connectedUsers.length > 0 && connectedUsers.every((user) => user.ready);
}

function snapshot() {
  const users = Array.isArray(state.room?.users) ? state.room.users : [];
  const connectedUsers = users.filter((user) => user.connected);
  const me = currentUser();

  return {
    connected: state.connected,
    connecting: state.connecting,
    joined: state.joined,
    roomId: state.roomId,
    name: state.name,
    participantId: state.participantId,
    isHost: Boolean(me?.isHost),
    ready: Boolean(me?.ready),
    userCount: connectedUsers.length,
    readyCount: connectedUsers.filter((user) => user.ready).length,
    everyoneReady:
      connectedUsers.length >= 2 &&
      connectedUsers.every((user) => user.ready),
    video: { ...state.video },
    error: state.error,
    lastEvent: state.lastEvent,
    followPrompt: computeFollowPrompt(),
    users: connectedUsers.map((user) => ({
      participantId: user.participantId,
      name: user.name,
      ready: user.ready,
      isHost: user.isHost,
      videoId: user.videoId || "",
      videoFound: Boolean(user.videoFound),
    })),
  };
}

async function persistSession() {
  if (!state.joined) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      roomId: state.roomId,
      name: state.name,
      participantId: state.participantId,
      controlledTabId: state.controlledTabId,
    },
  });
}

async function clearSession() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

async function sendToControlledTab(message) {
  if (!Number.isInteger(state.controlledTabId)) return null;

  try {
    return await chrome.tabs.sendMessage(state.controlledTabId, message);
  } catch {
    state.video.found = false;
    return null;
  }
}

function emitWithAck(eventName, payload = {}) {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ success: false, message: "The TogetherScreen server is offline." });
      return;
    }

    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve({ success: false, message: "The server did not respond in time." });
    }, CONFIG.SOCKET_TIMEOUT_MS);

    socket.emit(eventName, payload, (response) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(response || { success: false, message: "No server response." });
    });
  });
}

function startKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);

  keepAliveTimer = setInterval(() => {
    if (!socket?.connected) return;
    // Socket.IO traffic resets the service worker idle timer in Chrome 116+.
    socket.emit("extension-heartbeat", { at: Date.now() });
  }, 20_000);
}

function stopKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

function stopHostSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

function updateHostSync() {
  stopHostSync();

  if (!state.joined || !currentUser()?.isHost) return;

  syncTimer = setInterval(async () => {
    if (!socket?.connected || !state.video.found) return;

    const response = await sendToControlledTab({ type: "TS_GET_VIDEO_STATE" });
    if (!response?.success || !response.video) return;

    state.video = { ...state.video, ...response.video };
    maybeReportVideoInfo();
    socket.emit("sync-state", {
      roomId: state.roomId,
      time: Number(state.video.currentTime) || 0,
      isPlaying: !state.video.paused,
    });
  }, CONFIG.SYNC_INTERVAL_MS);
}

async function applyRoomResponse(response, request) {
  if (!response?.success || !response.room) return response;

  state.joined = true;
  state.roomId = response.room.roomId;
  state.name = request.name;
  state.participantId = response.participantId || request.participantId;
  state.controlledTabId = request.tabId;
  state.room = response.room;
  state.error = "";
  state.lastEvent = `Joined ${state.roomId}`;
  updateHostVideoTracking();

  await persistSession();
  updateHostSync();

  if (response.room.playback) {
    await sendToControlledTab({
      type: "TS_APPLY_PLAYBACK_SNAPSHOT",
      playback: response.room.playback,
    });
  }

  return { success: true, state: snapshot() };
}

async function createRoom(payload) {
  const roomId = normalizeRoomId(payload.roomId);
  const name = normalizeName(payload.name);
  const participantId = state.participantId || makeParticipantId();

  if (!/^[A-Za-z0-9_-]{3,40}$/.test(roomId)) {
    return {
      success: false,
      message: "Room codes need 3–40 letters, numbers, underscores, or hyphens.",
    };
  }

  if (!name) return { success: false, message: "Enter your name." };

  const response = await emitWithAck("create-room", {
    roomId,
    name,
    participantId,
  });

  return applyRoomResponse(response, {
    roomId,
    name,
    participantId,
    tabId: payload.tabId,
  });
}

async function joinRoom(payload, { rejoin = false } = {}) {
  const roomId = normalizeRoomId(payload.roomId);
  const name = normalizeName(payload.name);
  const participantId = payload.participantId || state.participantId || makeParticipantId();

  if (!roomId || !name) {
    return { success: false, message: "Enter a valid name and room code." };
  }

  const response = await emitWithAck(rejoin ? "rejoin-room" : "join-room", {
    roomId,
    name,
    participantId,
  });

  return applyRoomResponse(response, {
    roomId,
    name,
    participantId,
    tabId: payload.tabId,
  });
}

async function leaveRoom() {
  if (state.joined && socket?.connected) {
    await emitWithAck("leave-room");
  }

  stopHostSync();
  state.joined = false;
  state.roomId = "";
  state.name = "";
  state.participantId = "";
  state.room = null;
  state.error = "";
  state.lastEvent = "Left the room";
  lastReportedVideoId = null;
  lastReportedVideoFound = null;
  lastReportedFollowUrl = null;
  hostVideoTracking = { known: false, videoId: "" };
  hostChangedToVideoId = "";
  followPromptDismissedFor = "";
  await clearSession();

  return { success: true, state: snapshot() };
}

async function toggleReady() {
  const me = currentUser();
  if (!state.joined || !me) {
    return { success: false, message: "Join a room first." };
  }

  const response = await emitWithAck("ready-change", {
    roomId: state.roomId,
    ready: !me.ready,
  });

  return response?.success
    ? { success: true, state: snapshot() }
    : { success: false, message: "Could not update ready status." };
}

// Restarts playback (seek to 0:00 + play) for every participant in the room.
// Host-only, and only sent once every connected participant is Ready — the
// server re-checks this too (see restart-together) before broadcasting.
async function restartTogether() {
  if (!state.joined || !currentUser()?.isHost) {
    return { success: false, message: "Only the host can restart playback." };
  }

  if (!isEveryoneReady()) {
    return { success: false, message: "Not everyone is ready yet." };
  }

  return emitWithAck("restart-together", { roomId: state.roomId });
}

// Hands Host controls to another connected participant. Host-only; the
// server re-validates the caller is the current host and the target is a
// connected room member before moving room.hostParticipantId.
async function transferHost(targetParticipantId) {
  if (!state.joined || !currentUser()?.isHost) {
    return { success: false, message: "Only the host can transfer host controls." };
  }

  const response = await emitWithAck("transfer-host", {
    roomId: state.roomId,
    targetParticipantId,
  });

  return response?.success
    ? { success: true, state: snapshot() }
    : {
        success: false,
        message: response?.message || "Could not transfer host controls.",
      };
}

// Dismisses the Follow Host prompt for whichever host video it's currently
// showing for. Does not navigate, leave the room, or touch Ready state.
function dismissFollowPrompt() {
  const hostUser = state.room?.users?.find((user) => user.isHost);
  followPromptDismissedFor = hostUser?.videoFound ? hostUser.videoId || "" : "";
  return { success: true, state: snapshot() };
}

async function refreshVideo(tabId) {
  if (Number.isInteger(tabId)) state.controlledTabId = tabId;
  const response = await sendToControlledTab({ type: "TS_RESCAN_VIDEO" });

  if (response?.video) {
    state.video = { ...state.video, ...response.video };
    maybeReportVideoInfo();
  }

  await persistSession();
  return { success: Boolean(response?.success), state: snapshot() };
}

function connectSocket() {
  if (typeof io !== "function") {
    state.connected = false;
    state.connecting = false;
    state.error = "The Socket.IO client failed to load.";
    return;
  }

  // Keep the current connection when it is already working.
  if (socket?.connected || state.connecting) {
    return;
  }

  // Remove a previous failed or disconnected socket.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  state.connecting = true;
  state.error = "";

  socket = io(CONFIG.SERVER_URL, {
    path: "/socket.io/",
    autoConnect: true,
    forceNew: true,

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,

    timeout: 90000,

    // Required for the Manifest V3 service worker.
    transports: ["websocket"],
    upgrade: false,
  });

  socket.on("connect", async () => {
    console.log("SOCKET.IO CONNECTED", {
      socketId: socket.id,
      serverUrl: CONFIG.SERVER_URL,
      transport: socket.io.engine.transport.name,
    });

    state.connected = true;
    state.connecting = false;
    state.error = "";
    startKeepAlive();

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const session = stored[STORAGE_KEY];

    if (session?.roomId && session?.name) {
      const response = await joinRoom(
        {
          ...session,
          tabId: session.controlledTabId,
        },
        { rejoin: true }
      );

      if (!response?.success) {
        state.error =
          response?.message || "Could not restore the previous room.";
        await clearSession();
      }
    }
  });

  socket.on("disconnect", () => {
    state.connected = false;
    state.connecting = true;
    stopKeepAlive();
    stopHostSync();
  });

  socket.on("connect_error", (error) => {
    console.error("SOCKET.IO CONNECTION ERROR", {
      serverUrl: CONFIG.SERVER_URL,
      message: error?.message,
      description: error?.description,
      type: error?.type,
      context: error?.context,
    });

    state.connected = false;
    state.connecting = false;
    state.error = error?.message || "Could not connect to the server.";
  });

  socket.on("room-status", (room) => {
    if (!room || room.roomId !== state.roomId) return;
    state.room = room;
    state.error = "";
    updateHostVideoTracking();
    updateHostSync();
  });

  socket.on("room-closed", async (event = {}) => {
    state.error = event.message || "The host ended the room.";
    await leaveRoom();
  });

  socket.on("video-event", async (event) => {
    // Synchronization only applies while this participant is Ready.
    if (!currentUser()?.ready) return;

    console.log("RECEIVED VIDEO EVENT FROM SERVER", {
      event,
      controlledTabId: state.controlledTabId,
      joined: state.joined,
      roomId: state.roomId,
    });

    state.lastEvent = `Received ${event.type} at ${Number(event.time).toFixed(1)}s`;

    const result = await sendToControlledTab({
      type: "TS_APPLY_VIDEO_EVENT",
      event,
    });

    console.log("SENT EVENT TO VIDEO TAB", result);
  });

  socket.on("sync-state", async (event) => {
    if (!currentUser()?.ready) return;
    await sendToControlledTab({ type: "TS_APPLY_SYNC_STATE", event });
  });

  socket.on("start-together", async (event) => {
    if (!currentUser()?.ready) return;
    state.lastEvent = "Starting together";
    await sendToControlledTab({ type: "TS_START_TOGETHER", event });
  });

  socket.on("restart-together", async (event = {}) => {
    if (!currentUser()?.ready) return;
    state.lastEvent = "Restarting together";
    await sendToControlledTab({ type: "TS_RESTART_TOGETHER", event });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  connectSocket();
});

chrome.runtime.onStartup.addListener(() => {
  connectSocket();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (state.controlledTabId === tabId) {
    state.controlledTabId = null;
    state.video.found = false;
    await persistSession();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  connectSocket();

  (async () => {
    switch (message?.type) {
      case "TS_GET_STATE": {
        if (Number.isInteger(message.tabId)) {
          state.controlledTabId = message.tabId;
          await refreshVideo(message.tabId);
        }
        return { success: true, state: snapshot() };
      }

      case "TS_CREATE_ROOM":
        return createRoom(message);

      case "TS_JOIN_ROOM":
        return joinRoom(message);

      case "TS_LEAVE_ROOM":
        return leaveRoom();

      case "TS_TOGGLE_READY":
        return toggleReady();

      case "TS_RESTART_TOGETHER":
        return restartTogether();

      case "TS_TRANSFER_HOST":
        return transferHost(message.targetParticipantId);

      case "TS_DISMISS_FOLLOW_PROMPT":
        return dismissFollowPrompt();

      case "TS_RESCAN_VIDEO":
        return refreshVideo(message.tabId);

      case "TS_VIDEO_STATE":
        if (sender.tab?.id === state.controlledTabId && message.video) {
          state.video = { ...state.video, ...message.video };
          maybeReportVideoInfo();
        }
        return { success: true };

      case "TS_LOCAL_VIDEO_EVENT": {
        console.log("TS_LOCAL_VIDEO_EVENT DEBUG", {
          senderTabId: sender.tab?.id,
          controlledTabId: state.controlledTabId,
          joined: state.joined,
          participantId: state.participantId,
          isHost: currentUser()?.isHost,
          socketConnected: socket?.connected,
          roomId: state.roomId,
          event: message.event,
        });

        if (
          sender.tab?.id === state.controlledTabId &&
          state.joined &&
          currentUser()?.isHost &&
          socket?.connected
        ) {
          const event = message.event || {};

          console.log("SENDING VIDEO EVENT TO SERVER", {
            roomId: state.roomId,
            type: event.type,
            time: Number(event.time) || 0,
            isPlaying: Boolean(event.isPlaying),
          });

          socket.emit("video-event", {
            roomId: state.roomId,
            type: event.type,
            time: Number(event.time) || 0,
            isPlaying: Boolean(event.isPlaying),
          });

          state.lastEvent = `${event.type} at ${Number(event.time).toFixed(1)}s`;
        } else {
          console.warn("VIDEO EVENT BLOCKED");
        }

        return { success: true };
      }

      default:
        return { success: false, message: "Unknown extension request." };
    }
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        success: false,
        message: error instanceof Error ? error.message : "Unexpected extension error.",
      });
    });

  return true;
});

connectSocket();
