const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// rooms structure:
// {
//   "room1": {
//     users: {
//       "socket-id": {
//         name: "Seoungwan",
//         ready: false
//       }
//     },
//     movieTitle: "La La Land",
//     movieYear: "2016",
//     platform: "Netflix"
//   }
// }
const rooms = {};

app.get("/", (req, res) => {
  res.send("TogetherScreen server is running");
});

function getRoomUsers(roomId) {
  if (!rooms[roomId]) {
    return {};
  }

  return rooms[roomId].users;
}

function sendRoomStatus(roomId) {
  if (!rooms[roomId]) {
    return;
  }

  const users = getRoomUsers(roomId);

  const userList = Object.entries(users).map(([socketId, user]) => ({
    socketId,
    name: user.name,
    ready: user.ready,
  }));

  console.log("Sending room-status:", roomId, userList);

  io.to(roomId).emit("room-status", {
    roomId,
    users: userList,
    movieTitle: rooms[roomId].movieTitle,
    movieYear: rooms[roomId].movieYear,
    platform: rooms[roomId].platform,
  });
}

function removeUserFromCurrentRoom(socket) {
  const previousRoomId = socket.data.roomId;

  if (!previousRoomId || !rooms[previousRoomId]) {
    return;
  }

  socket.leave(previousRoomId);
  delete rooms[previousRoomId].users[socket.id];

  if (Object.keys(rooms[previousRoomId].users).length === 0) {
    delete rooms[previousRoomId];
  } else {
    sendRoomStatus(previousRoomId);
  }

  socket.data.roomId = null;
  socket.data.name = null;
}

function addUserToRoom(socket, roomId, name) {
  removeUserFromCurrentRoom(socket);

  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.name = name;

  rooms[roomId].users[socket.id] = {
    name,
    ready: false,
  };

  console.log(`${name} (${socket.id}) joined room ${roomId}`);

  sendRoomStatus(roomId);
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  
  socket.on("extension-join-room", (event) => {
    console.log("extension-join-room received:", event, "from", socket.id);

    const roomId = event.roomId;
    const name = event.name || "Extension User";

    if (!rooms[roomId]) {
      socket.emit("extension-error", {
        message: "Room does not exist. Create the room on the website first.",
      });
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;
    socket.data.isExtension = true;

    console.log(`Extension for ${name} joined room ${roomId}`);
  });

  socket.on("create-room", (event) => {
    console.log("create-room received:", event, "from", socket.id);

    const roomId = event.roomId;
    const name = event.name || "Anonymous";
    const movieTitle = event.movieTitle || "Untitled Movie";
    const movieYear = event.movieYear || "Unknown Year";
    const platform = event.platform || "Unknown Platform";

    if (rooms[roomId]) {
      socket.emit("room-error", {
        message: "This room already exists. Try joining it instead.",
      });
      return;
    }

    rooms[roomId] = {
      users: {},
      movieTitle,
      movieYear,
      platform,
    };

    addUserToRoom(socket, roomId, name);
  });

  socket.on("join-room", (event) => {
    console.log("join-room received:", event, "from", socket.id);

    const roomId = event.roomId;
    const name = event.name || "Anonymous";

    if (!rooms[roomId]) {
      socket.emit("room-error", {
        message: "Room does not exist. Ask the host to create it first.",
      });
      return;
    }

    addUserToRoom(socket, roomId, name);
  });

  socket.on("ready-change", (event) => {
    console.log("ready-change received:", event, "from", socket.id);

    const { roomId, ready } = event;

    if (!rooms[roomId]) {
      console.log("ready-change ignored: room does not exist");
      return;
    }

    if (!rooms[roomId].users[socket.id]) {
      console.log("ready-change ignored: user is not in this room");
      return;
    }

    rooms[roomId].users[socket.id].ready = ready;

    console.log(
      `${rooms[roomId].users[socket.id].name} ready in ${roomId}: ${ready}`
    );

    sendRoomStatus(roomId);
  });

  socket.on("start-together", (event) => {
    console.log("start-together received:", event, "from", socket.id);

    const { roomId, time } = event;

    const users = getRoomUsers(roomId);
    const userList = Object.values(users);

    if (userList.length < 2) {
      socket.emit("start-error", {
        message: "You need at least 2 people in the room to start together.",
      });
      return;
    }

    const everyoneReady = userList.every((user) => user.ready);

    if (!everyoneReady) {
      socket.emit("start-error", {
        message: "Not everyone is ready yet.",
      });
      return;
    }

    console.log(`Starting room ${roomId} together`);

    io.to(roomId).emit("start-together", {
      roomId,
      time,
    });
  });

  socket.on("video-event", (event) => {
    console.log("video-event received:", event, "from", socket.id);

    const { roomId } = event;

    if (socket.data.roomId !== roomId) {
      console.log("video-event ignored: user is not in this room");
      return;
    }

    socket.to(roomId).emit("video-event", event);
  });

  socket.on("chat-message", (event) => {
    console.log("chat-message received:", event, "from", socket.id);

    const { roomId, message } = event;

    if (socket.data.roomId !== roomId) {
      console.log("chat-message ignored: user is not in this room");
      return;
    }

    const trimmedMessage = message.trim();

    if (trimmedMessage === "") {
      console.log("chat-message ignored: empty message");
      return;
    }

    const chatMessage = {
      senderId: socket.id,
      senderName: socket.data.name || "Anonymous",
      message: trimmedMessage,
      sentAt: new Date().toLocaleTimeString(),
    };

    console.log("Broadcasting chat-message:", chatMessage);

    io.to(roomId).emit("chat-message", chatMessage);
  });

  socket.on("leave-room", () => {
    console.log("leave-room received from", socket.id);
    removeUserFromCurrentRoom(socket);
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    removeUserFromCurrentRoom(socket);
  });
});

server.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});