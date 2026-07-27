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
  },
  error: "",
  lastEvent: "Waiting for a video tab",
};

let socket = null;
let syncTimer = null;
let keepAliveTimer = null;

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
    users: connectedUsers.map((user) => ({
      participantId: user.participantId,
      name: user.name,
      ready: user.ready,
      isHost: user.isHost,
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

async function startTogether() {
  if (!state.joined || !currentUser()?.isHost) {
    return { success: false, message: "Only the host can start playback." };
  }

  const videoResponse = await sendToControlledTab({ type: "TS_GET_VIDEO_STATE" });
  if (!videoResponse?.success || !videoResponse.video?.found) {
    return { success: false, message: "No playable video was detected in this tab." };
  }

  state.video = { ...state.video, ...videoResponse.video };

  return emitWithAck("start-together", {
    roomId: state.roomId,
    time: Number(state.video.currentTime) || 0,
  });
}

async function refreshVideo(tabId) {
  if (Number.isInteger(tabId)) state.controlledTabId = tabId;
  const response = await sendToControlledTab({ type: "TS_RESCAN_VIDEO" });

  if (response?.video) {
    state.video = { ...state.video, ...response.video };
  }

  await persistSession();
  return { success: Boolean(response?.success), state: snapshot() };
}

function connectSocket() {
  if (socket || typeof io !== "function") return;

  state.connecting = true;
  socket = io(CONFIG.SERVER_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    transports: ["websocket", "polling"],
  });

  socket.on("connect", async () => {
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
        state.error = response?.message || "Could not restore the previous room.";
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
    state.connected = false;
    state.connecting = false;
    state.error = error?.message || "Could not connect to the server.";
  });

  socket.on("room-status", (room) => {
    if (!room || room.roomId !== state.roomId) return;
    state.room = room;
    state.error = "";
    updateHostSync();
  });

  socket.on("room-closed", async (event = {}) => {
    state.error = event.message || "The host ended the room.";
    await leaveRoom();
  });

  socket.on("video-event", async (event) => {
    state.lastEvent = `Received ${event.type} at ${Number(event.time).toFixed(1)}s`;
    await sendToControlledTab({ type: "TS_APPLY_VIDEO_EVENT", event });
  });

  socket.on("sync-state", async (event) => {
    await sendToControlledTab({ type: "TS_APPLY_SYNC_STATE", event });
  });

  socket.on("start-together", async (event) => {
    state.lastEvent = "Starting together";
    await sendToControlledTab({ type: "TS_START_TOGETHER", event });
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

      case "TS_START_TOGETHER":
        return startTogether();

      case "TS_RESCAN_VIDEO":
        return refreshVideo(message.tabId);

      case "TS_VIDEO_STATE":
        if (sender.tab?.id === state.controlledTabId && message.video) {
          state.video = { ...state.video, ...message.video };
        }
        return { success: true };

      case "TS_LOCAL_VIDEO_EVENT": {
        if (
          sender.tab?.id === state.controlledTabId &&
          state.joined &&
          currentUser()?.isHost &&
          socket?.connected
        ) {
          const event = message.event || {};
          socket.emit("video-event", {
            roomId: state.roomId,
            type: event.type,
            time: Number(event.time) || 0,
            isPlaying: Boolean(event.isPlaying),
          });
          state.lastEvent = `${event.type} at ${Number(event.time).toFixed(1)}s`;
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
