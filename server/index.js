require("dotenv").config();

const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3001;
const RECONNECT_GRACE_MS = 15_000;
const MAX_CHAT_HISTORY = 100;
const allowedOrigins = (process.env.CLIENT_URLS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedSocketOrigin(origin) {
  return (
    !origin ||
    allowedOrigins.includes(origin) ||
    origin.startsWith("chrome-extension://")
  );
}

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedSocketOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Socket origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;
const VIDEO_EVENT_TYPES = new Set(["play", "pause", "seek"]);

app.get("/", (_request, response) => {
  response.send("TogetherScreen server is running");
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size });
});

function reply(callback, payload) {
  if (typeof callback === "function") {
    callback(payload);
  }
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeRoomId(value) {
  const roomId = normalizeText(value, 40);
  return ROOM_ID_PATTERN.test(roomId) ? roomId : "";
}

function normalizeParticipantId(value) {
  const participantId = normalizeText(value, 100);
  return PARTICIPANT_ID_PATTERN.test(participantId) ? participantId : "";
}

function makeParticipantId() {
  return randomUUID();
}

function isValidTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function getPlaybackSnapshot(room) {
  const elapsedSeconds = room.playback.isPlaying
    ? Math.max(0, Date.now() - room.playback.updatedAt) / 1000
    : 0;

  return {
    currentTime: room.playback.currentTime + elapsedSeconds,
    isPlaying: room.playback.isPlaying,
    updatedAt: room.playback.updatedAt,
  };
}

function makeMessage({ type = "user", participantId = null, name, message }) {
  return {
    id: randomUUID(),
    type,
    senderParticipantId: participantId,
    senderName: name,
    message,
    sentAt: new Date().toISOString(),
  };
}

function appendMessage(room, message) {
  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_HISTORY) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_HISTORY);
  }
}

function emitSystemMessage(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  const chatMessage = makeMessage({
    type: "system",
    name: "TogetherScreen",
    message,
  });

  appendMessage(room, chatMessage);
  io.to(roomId).emit("chat-message", chatMessage);
}

function getRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const users = Array.from(room.users.entries()).map(
    ([participantId, user]) => ({
      participantId,
      name: user.name,
      ready: user.ready,
      connected: Boolean(user.socketId),
      isHost: room.hostParticipantId === participantId,
      joinedAt: user.joinedAt,
    })
  );

  return {
    roomId,
    users,
    connectedUserCount: users.filter((user) => user.connected).length,
    movieTitle: room.movieTitle,
    movieYear: room.movieYear,
    platform: room.platform,
    playback: getPlaybackSnapshot(room),
    messages: room.messages,
    createdAt: room.createdAt,
  };
}

function sendRoomStatus(roomId) {
  const status = getRoomState(roomId);
  if (status) {
    io.to(roomId).emit("room-status", status);
  }
}

function pickNextHost(room) {
  const connectedEntry = Array.from(room.users.entries()).find(
    ([, user]) => user.socketId
  );

  if (connectedEntry) return connectedEntry[0];
  return room.users.keys().next().value || null;
}

function permanentlyRemoveParticipant(roomId, participantId, reason = "left") {
  const room = rooms.get(roomId);
  if (!room) return;

  const user = room.users.get(participantId);
  if (!user) return;

  if (user.disconnectTimer) {
    clearTimeout(user.disconnectTimer);
  }

  const wasHost = room.hostParticipantId === participantId;
  const departingName = user.name;
  room.users.delete(participantId);

  if (room.users.size === 0) {
    rooms.delete(roomId);
    return;
  }

  if (wasHost) {
    room.hostParticipantId = pickNextHost(room);
  }

  emitSystemMessage(
    roomId,
    reason === "disconnected"
      ? `${departingName} disconnected.`
      : `${departingName} left the room.`
  );

  if (wasHost && room.hostParticipantId) {
    const newHost = room.users.get(room.hostParticipantId);
    if (newHost) {
      emitSystemMessage(roomId, `${newHost.name} is now the host.`);
    }
  }

  sendRoomStatus(roomId);
}

function removeSocketFromCurrentRoom(
  socket,
  { immediate = false, reason = "left" } = {}
) {
  const roomId = socket.data.roomId;
  const participantId = socket.data.participantId;

  if (!roomId || !participantId) return;

  socket.leave(roomId);

  const room = rooms.get(roomId);
  const user = room?.users.get(participantId);

  if (user && user.socketId === socket.id) {
    user.socketId = null;

    if (immediate) {
      permanentlyRemoveParticipant(roomId, participantId, reason);
    } else {
      if (user.disconnectTimer) clearTimeout(user.disconnectTimer);

      user.disconnectTimer = setTimeout(() => {
        permanentlyRemoveParticipant(roomId, participantId, "disconnected");
      }, RECONNECT_GRACE_MS);

      sendRoomStatus(roomId);
    }
  }

  socket.data.roomId = null;
  socket.data.participantId = null;
  socket.data.name = null;
  socket.data.isExtension = false;
}

/**
 * Two tabs can accidentally share the same browser-side participant ID.
 * If that ID is already connected from another socket, assign a fresh one.
 * This prevents a joining user from replacing the host and keeps the count correct.
 */
function resolveParticipantId(room, requestedParticipantId, socketId) {
  const requested =
    normalizeParticipantId(requestedParticipantId) || makeParticipantId();
  const existing = room.users.get(requested);

  if (!existing || existing.socketId === socketId || !existing.socketId) {
    return requested;
  }

  return makeParticipantId();
}

function addUserToRoom(socket, roomId, requestedParticipantId, name) {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (socket.data.roomId && socket.data.roomId !== roomId) {
    removeSocketFromCurrentRoom(socket, { immediate: true, reason: "left" });
  }

  const participantId = resolveParticipantId(
    room,
    requestedParticipantId,
    socket.id
  );

  let user = room.users.get(participantId);
  const isNewParticipant = !user;

  if (user) {
    if (user.disconnectTimer) clearTimeout(user.disconnectTimer);
    user.socketId = socket.id;
    user.name = name;
    user.disconnectTimer = null;
  } else {
    user = {
      socketId: socket.id,
      name,
      ready: false,
      joinedAt: new Date().toISOString(),
      disconnectTimer: null,
    };
    room.users.set(participantId, user);
  }

  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.participantId = participantId;
  socket.data.name = name;
  socket.data.isExtension = false;

  if (isNewParticipant && room.users.size > 1) {
    emitSystemMessage(roomId, `${name} joined the room.`);
  }

  sendRoomStatus(roomId);

  return {
    participantId,
    room: getRoomState(roomId),
  };
}

function validateMembership(socket, roomId) {
  const room = rooms.get(roomId);
  const participantId = socket.data.participantId;
  const user = participantId ? room?.users.get(participantId) : null;

  return Boolean(
    room &&
      participantId &&
      socket.data.roomId === roomId &&
      user?.socketId === socket.id
  );
}

function clearRoomTimers(room) {
  for (const user of room.users.values()) {
    if (user.disconnectTimer) clearTimeout(user.disconnectTimer);
  }
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create-room", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);
    const name = normalizeText(event.name, 30);
    const movieTitle = normalizeText(event.movieTitle, 80) || "Private Watch Party";
    const movieYear = normalizeText(event.movieYear, 12);
    const platform = normalizeText(event.platform, 50);

    if (!roomId) {
      reply(callback, {
        success: false,
        message:
          "Room ID must be 3–40 characters and use only letters, numbers, underscores, or hyphens.",
      });
      return;
    }

    if (!name) {
      reply(callback, {
        success: false,
        message: "Enter your name before creating a room.",
      });
      return;
    }

    if (rooms.has(roomId)) {
      reply(callback, {
        success: false,
        message: "This room already exists. Try joining it instead.",
      });
      return;
    }

    const requestedParticipantId =
      normalizeParticipantId(event.participantId) || makeParticipantId();

    rooms.set(roomId, {
      hostParticipantId: requestedParticipantId,
      users: new Map(),
      movieTitle,
      movieYear,
      platform,
      playback: {
        currentTime: 0,
        isPlaying: false,
        updatedAt: Date.now(),
      },
      messages: [],
      createdAt: new Date().toISOString(),
    });

    const result = addUserToRoom(
      socket,
      roomId,
      requestedParticipantId,
      name
    );

    // addUserToRoom can only reassign an ID on a collision. A brand-new room
    // cannot collide, but assigning this explicitly keeps the invariant clear.
    rooms.get(roomId).hostParticipantId = result.participantId;
    sendRoomStatus(roomId);

    reply(callback, {
      success: true,
      participantId: result.participantId,
      room: getRoomState(roomId),
    });
  });

  function joinRoom(event = {}, callback) {
    const roomId = normalizeRoomId(event.roomId);
    const name = normalizeText(event.name, 30);

    if (!roomId || !name) {
      reply(callback, {
        success: false,
        message: "Enter a valid room ID and name.",
      });
      return;
    }

    if (!rooms.has(roomId)) {
      reply(callback, {
        success: false,
        message: "Room does not exist. Ask the host to create it first.",
      });
      return;
    }

    const result = addUserToRoom(
      socket,
      roomId,
      event.participantId,
      name
    );

    reply(callback, {
      success: true,
      participantId: result.participantId,
      room: result.room,
    });
  }

  socket.on("join-room", joinRoom);
  socket.on("rejoin-room", joinRoom);

  socket.on("ready-change", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);

    if (
      !roomId ||
      typeof event.ready !== "boolean" ||
      !validateMembership(socket, roomId)
    ) {
      reply(callback, { success: false });
      return;
    }

    const room = rooms.get(roomId);
    room.users.get(socket.data.participantId).ready = event.ready;
    sendRoomStatus(roomId);
    reply(callback, { success: true });
  });

  socket.on("start-together", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);
    const time = event.time;

    if (!roomId || !validateMembership(socket, roomId)) {
      reply(callback, {
        success: false,
        message: "You are not a member of this room.",
      });
      return;
    }

    const room = rooms.get(roomId);

    if (room.hostParticipantId !== socket.data.participantId) {
      reply(callback, {
        success: false,
        message: "Only the host can start playback.",
      });
      return;
    }

    if (!isValidTime(time)) {
      reply(callback, {
        success: false,
        message: "The playback time is invalid.",
      });
      return;
    }

    const connectedUsers = Array.from(room.users.values()).filter(
      (user) => user.socketId
    );

    if (connectedUsers.length < 2) {
      reply(callback, {
        success: false,
        message: "You need at least two connected people in the room.",
      });
      return;
    }

    if (!connectedUsers.every((user) => user.ready)) {
      reply(callback, {
        success: false,
        message: "Not everyone is ready yet.",
      });
      return;
    }

    const startAt = Date.now() + 3000;

    room.playback = {
      currentTime: time,
      isPlaying: true,
      updatedAt: startAt,
    };

    io.to(roomId).emit("start-together", {
      roomId,
      videoTime: time,
      startAt,
    });

    reply(callback, { success: true, startAt });
  });

  socket.on("video-event", (event = {}) => {
    const roomId = normalizeRoomId(event.roomId);
    const { type, time } = event;

    if (
      !roomId ||
      !VIDEO_EVENT_TYPES.has(type) ||
      !isValidTime(time) ||
      !validateMembership(socket, roomId)
    ) {
      return;
    }

    const room = rooms.get(roomId);
    if (room.hostParticipantId !== socket.data.participantId) return;

    room.playback = {
      currentTime: time,
      isPlaying:
        type === "play"
          ? true
          : type === "pause"
            ? false
            : Boolean(event.isPlaying),
      updatedAt: Date.now(),
    };

    socket.to(roomId).emit("video-event", {
      type,
      time,
      isPlaying: room.playback.isPlaying,
    });
  });

  socket.on("sync-state", (event = {}) => {
    const roomId = normalizeRoomId(event.roomId);
    const time = event.time;

    if (
      !roomId ||
      !isValidTime(time) ||
      typeof event.isPlaying !== "boolean" ||
      !validateMembership(socket, roomId)
    ) {
      return;
    }

    const room = rooms.get(roomId);
    if (room.hostParticipantId !== socket.data.participantId) return;

    room.playback = {
      currentTime: time,
      isPlaying: event.isPlaying,
      updatedAt: Date.now(),
    };

    socket.to(roomId).emit("sync-state", {
      time,
      isPlaying: event.isPlaying,
    });
  });

  socket.on("chat-message", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);
    const message = normalizeText(event.message, 500);

    if (!roomId || !message || !validateMembership(socket, roomId)) {
      reply(callback, { success: false });
      return;
    }

    const room = rooms.get(roomId);
    const chatMessage = makeMessage({
      participantId: socket.data.participantId,
      name: socket.data.name || "Anonymous",
      message,
    });

    appendMessage(room, chatMessage);
    io.to(roomId).emit("chat-message", chatMessage);
    reply(callback, { success: true });
  });

  socket.on("transfer-host", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);
    const targetParticipantId = normalizeParticipantId(
      event.targetParticipantId
    );

    if (!roomId || !validateMembership(socket, roomId)) {
      reply(callback, { success: false, message: "Invalid room membership." });
      return;
    }

    const room = rooms.get(roomId);

    if (room.hostParticipantId !== socket.data.participantId) {
      reply(callback, {
        success: false,
        message: "Only the host can transfer host controls.",
      });
      return;
    }

    const target = room.users.get(targetParticipantId);
    if (!target || !target.socketId) {
      reply(callback, {
        success: false,
        message: "Choose a connected participant.",
      });
      return;
    }

    room.hostParticipantId = targetParticipantId;
    emitSystemMessage(roomId, `${target.name} is now the host.`);
    sendRoomStatus(roomId);
    reply(callback, { success: true });
  });

  socket.on("end-room", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);

    if (!roomId || !validateMembership(socket, roomId)) {
      reply(callback, { success: false, message: "Invalid room membership." });
      return;
    }

    const room = rooms.get(roomId);
    if (room.hostParticipantId !== socket.data.participantId) {
      reply(callback, {
        success: false,
        message: "Only the host can end the room.",
      });
      return;
    }

    clearRoomTimers(room);
    io.to(roomId).emit("room-closed", {
      message: `${socket.data.name || "The host"} ended the room.`,
    });
    io.in(roomId).socketsLeave(roomId);
    rooms.delete(roomId);
    reply(callback, { success: true });
  });

  socket.on("extension-heartbeat", (_event, callback) => {
    reply(callback, { success: true, at: Date.now() });
  });

  socket.on("extension-join-room", (event = {}, callback) => {
    const roomId = normalizeRoomId(event.roomId);

    if (!roomId || !rooms.has(roomId)) {
      reply(callback, {
        success: false,
        message: "Room does not exist. Create it on the website first.",
      });
      return;
    }

    removeSocketFromCurrentRoom(socket, { immediate: true });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = normalizeText(event.name, 30) || "Extension";
    socket.data.isExtension = true;

    reply(callback, { success: true, room: getRoomState(roomId) });
  });

  socket.on("leave-room", (_event, callback) => {
    removeSocketFromCurrentRoom(socket, { immediate: true, reason: "left" });
    reply(callback, { success: true });
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    removeSocketFromCurrentRoom(socket, { immediate: false });
  });
});

server.listen(PORT, () => {
  console.log(`TogetherScreen server running on port ${PORT}`);
  console.log(`Allowed client origins: ${allowedOrigins.join(", ")}`);
});
