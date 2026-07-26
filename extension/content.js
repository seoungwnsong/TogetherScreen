if (globalThis.__TOGETHER_SCREEN_EXTENSION_LOADED__) {
  console.log("TogetherScreen: extension already loaded, skipping.");
} else {
  globalThis.__TOGETHER_SCREEN_EXTENSION_LOADED__ = true;

  console.log("TogetherScreen extension loaded.");

  let socket = null;
  let currentRoomId = null;
  let currentName = null;
  let isRemoteUpdate = false;

  const detectedVideos = new WeakSet();

  function connectToServer(name, roomId) {
    if (!name || !roomId) {
      console.log("TogetherScreen: name or roomId missing.");
      return;
    }

    currentName = name;
    currentRoomId = roomId;

    if (!socket) {
      socket = io("http://localhost:3001");

      socket.on("connect", () => {
        console.log("TogetherScreen extension connected to server:", socket.id);

        socket.emit("extension-join-room", {
          name: currentName,
          roomId: currentRoomId,
        });
      });

      socket.on("extension-error", (error) => {
        console.log("TogetherScreen extension error:", error.message);
      });

      socket.on("video-event", async (event) => {
        console.log("TogetherScreen received remote video event:", event);

        const video = document.querySelector("video");

        if (!video) {
          return;
        }

        isRemoteUpdate = true;

        if (event.type === "play") {
          video.currentTime = event.time;
          await video.play();
        }

        if (event.type === "pause") {
          video.currentTime = event.time;
          video.pause();
        }

        if (event.type === "seek") {
          video.currentTime = event.time;
        }

        setTimeout(() => {
          isRemoteUpdate = false;
        }, 500);
      });
    } else if (socket.connected) {
      socket.emit("extension-join-room", {
        name: currentName,
        roomId: currentRoomId,
      });
    }
  }

  function sendVideoEvent(type, video) {
    if (!socket || !socket.connected) {
      console.log("TogetherScreen: socket not connected yet.");
      return;
    }

    if (!currentRoomId) {
      console.log("TogetherScreen: no room selected yet.");
      return;
    }

    if (isRemoteUpdate) {
      return;
    }

    const event = {
      roomId: currentRoomId,
      type,
      time: video.currentTime,
    };

    console.log("TogetherScreen sending video event:", event);

    socket.emit("video-event", event);
  }

  function setupVideoDetector(video) {
    if (!video) {
      return;
    }

    if (detectedVideos.has(video)) {
      return;
    }

    detectedVideos.add(video);

    console.log("TogetherScreen: Video found!", video);

    video.addEventListener("play", () => {
      sendVideoEvent("play", video);
    });

    video.addEventListener("pause", () => {
      sendVideoEvent("pause", video);
    });

    video.addEventListener("seeked", () => {
      sendVideoEvent("seek", video);
    });
  }

  function findVideos() {
    const videos = document.querySelectorAll("video");

    videos.forEach((video) => {
      setupVideoDetector(video);
    });
  }

  function loadRoomInfoAndConnect() {
    chrome.storage.local.get(["name", "roomId"], (data) => {
      console.log("TogetherScreen stored room info:", data);

      if (data.name && data.roomId) {
        connectToServer(data.name, data.roomId);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.name || changes.roomId) {
      loadRoomInfoAndConnect();
    }
  });

  findVideos();
  loadRoomInfoAndConnect();

  const observer = new MutationObserver(() => {
    findVideos();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}