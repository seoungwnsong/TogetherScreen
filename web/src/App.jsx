import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";
import togetherScreenLogo from "./assets/together-screen-logo.png";
import worldMapBase from "./assets/world-map-base.png";
import worldNetworkLines from "./assets/world-network-lines.png";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});

const ROOM_SESSION_KEY = "togetherScreenRoomSession";
const PARTICIPANT_KEY = "togetherScreenTabParticipantId";
const DEMO_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function makeParticipantId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `participant_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}

function getTabParticipantId() {
  // sessionStorage is intentionally used instead of localStorage.
  // Each browser tab should represent a different room participant.
  const existing = sessionStorage.getItem(PARTICIPANT_KEY);
  if (existing) return existing;

  const generated = makeParticipantId();
  sessionStorage.setItem(PARTICIPANT_KEY, generated);
  return generated;
}

function roomIdFromPath() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function setRoomPath(roomId) {
  const nextPath = roomId ? `/room/${encodeURIComponent(roomId)}` : "/";
  window.history.pushState({}, "", nextPath);
}

function getInitials(value) {
  const parts = String(value || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function createRoomCode() {
  const first = ["night", "cinema", "screen", "movie", "watch"];
  const second = ["club", "room", "party", "lounge", "date"];
  const number = Math.floor(100 + Math.random() * 900);

  return `${first[Math.floor(Math.random() * first.length)]}-${
    second[Math.floor(Math.random() * second.length)]
  }-${number}`;
}

const WHY_FEATURES = [
  {
    icon: "globe",
    title: "Watch together from anywhere",
    description:
      "Open one room, invite your people, and stay on the same playback timeline even when you are in different cities or countries.",
  },
  {
    icon: "timeline",
    title: "One host, one shared timeline",
    description:
      "The host controls play, pause, seek, and synchronized starts, so the whole room stays aligned from the first scene to the credits.",
  },
  {
    icon: "chat",
    title: "Private rooms with live chat",
    description:
      "Keep the room private, see who is ready, and chat in real time while you watch together.",
  },
];

const FAQ_ITEMS = [
  {
    question: "How do I use TogetherScreen?",
    answer:
      "Create a room, choose a room code, share the invite link, and ask everyone to join. Once everyone is ready, the host starts the synchronized countdown and playback begins together.",
  },
  {
    question: "Who controls playback?",
    answer:
      "The room host controls the main playback timeline. The host can start the room, pause, play, seek, and even transfer host controls to another participant.",
  },
  {
    question: "Do I need to be in the same place?",
    answer:
      "No. TogetherScreen was built for remote watch parties. As long as everyone has the room link and joins the same room, you can watch together from anywhere.",
  },
];

function MapleMark() {
  return (
    <svg
      className="brand-mark-svg"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="brand-ring"
        d="M32 4.5c15.2 0 27.5 12.3 27.5 27.5S47.2 59.5 32 59.5 4.5 47.2 4.5 32 16.8 4.5 32 4.5Z"
      />
      <path
        className="brand-leaf"
        d="M32 11.5l3.7 7.1 7.9-2.4-2 7.4 7.8 3-5.5 5.4 5.2 4.4-7.8.7 1.1 9.8-6.3-3.5L32 54.2l-4.1-11.8-6.4 3.5 1.2-9.8-7.9-.7 5.3-4.4-5.6-5.4 7.8-3-2-7.4 7.9 2.4 3.8-7.1Z"
      />
      <path className="brand-stem" d="M32 35.5V53" />
    </svg>
  );
}

function FeatureIcon({ type }) {
  if (type === "globe") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="17" />
        <path d="M7 24h34M24 7c5.5 5.2 8.4 10.9 8.4 17S29.5 35.8 24 41M24 7c-5.5 5.2-8.4 10.9-8.4 17S18.5 35.8 24 41" />
        <circle cx="36" cy="13" r="3.2" />
      </svg>
    );
  }

  if (type === "timeline") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect x="6" y="10" width="36" height="28" rx="7" />
        <path d="M20 18.5 31 24l-11 5.5v-11Z" />
        <path d="M12 34h24M27 34h7" />
        <circle cx="27" cy="34" r="2.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 11.5h32v22H21l-8 6v-6H8v-22Z" />
      <circle cx="17" cy="22.5" r="2" />
      <circle cx="24" cy="22.5" r="2" />
      <circle cx="31" cy="22.5" r="2" />
    </svg>
  );
}

function App() {
  const videoRef = useRef(null);
  const chatEndRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const countdownTimer = useRef(null);
  const isHostRef = useRef(false);
  const generateEffectTimer = useRef(null);
  const participantIdRef = useRef(getTabParticipantId());

  const invitedRoomId = useMemo(roomIdFromPath, []);

  const [participantId, setParticipantId] = useState(participantIdRef.current);
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState(invitedRoomId);
  const [roomMode, setRoomMode] = useState(invitedRoomId ? "join" : "create");
  const [codeGenerated, setCodeGenerated] = useState(false);


  const [roomMovieTitle, setRoomMovieTitle] = useState("");
  const [roomMovieYear, setRoomMovieYear] = useState("");
  const [roomPlatform, setRoomPlatform] = useState("");

  const [joinedRoom, setJoinedRoom] = useState("");
  const [connected, setConnected] = useState(socket.connected);
  const [reconnecting, setReconnecting] = useState(false);
  const [pending, setPending] = useState(false);
  const [lastEvent, setLastEvent] = useState("Waiting for playback");
  const [ready, setReady] = useState(false);
  const [roomUsers, setRoomUsers] = useState([]);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [countdown, setCountdown] = useState(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);

  const joined = Boolean(joinedRoom);
  const connectedUsers = roomUsers.filter((user) => user.connected);
  const currentUser = roomUsers.find(
    (user) => user.participantId === participantId
  );
  const hostUser = roomUsers.find((user) => user.isHost);
  const isHost = Boolean(currentUser?.isHost);
  const everyoneReady =
    connectedUsers.length >= 2 && connectedUsers.every((user) => user.ready);
  const readyCount = connectedUsers.filter((user) => user.ready).length;

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatMessages]);

  useEffect(() => {
    if (!notice.text || notice.type === "error") return undefined;

    const timer = window.setTimeout(() => {
      setNotice({ type: "", text: "" });
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [notice]);

  function adoptParticipantId(nextParticipantId) {
    if (!nextParticipantId || nextParticipantId === participantIdRef.current) {
      return;
    }

    participantIdRef.current = nextParticipantId;
    sessionStorage.setItem(PARTICIPANT_KEY, nextParticipantId);
    setParticipantId(nextParticipantId);
  }

  function showNotice(text, type = "error") {
    setNotice({ type, text });
  }

  function clearNotice() {
    setNotice({ type: "", text: "" });
  }

  function handleGenerateRoomCode() {
    setRoomId(createRoomCode());
    setCodeGenerated(true);

    if (generateEffectTimer.current) {
      window.clearTimeout(generateEffectTimer.current);
    }

    generateEffectTimer.current = window.setTimeout(() => {
      setCodeGenerated(false);
    }, 700);
  }

  function saveRoomSession(nextRoomId, nextName) {
    sessionStorage.setItem(
      ROOM_SESSION_KEY,
      JSON.stringify({ roomId: nextRoomId, name: nextName })
    );
  }

  function clearRoomSession() {
    sessionStorage.removeItem(ROOM_SESSION_KEY);
  }

  function mergeMessages(messages = []) {
    setChatMessages((previous) => {
      const byId = new Map(previous.map((message) => [message.id, message]));
      for (const message of messages) {
        if (message?.id) byId.set(message.id, message);
      }
      return Array.from(byId.values()).sort(
        (a, b) => new Date(a.sentAt) - new Date(b.sentAt)
      );
    });
  }

  function applyRoomState(room) {
    if (!room) return;

    setRoomUsers(room.users || []);
    setRoomMovieTitle(room.movieTitle || "");
    setRoomMovieYear(room.movieYear || "");
    setRoomPlatform(room.platform || "");

    if (Array.isArray(room.messages)) {
      mergeMessages(room.messages);
    }
  }

  async function applyPlaybackSnapshot(playback) {
    const video = videoRef.current;
    if (!video || !playback) return;

    isRemoteUpdate.current = true;

    if (Math.abs(video.currentTime - playback.currentTime) > 0.25) {
      video.currentTime = playback.currentTime;
    }

    try {
      if (playback.isPlaying) {
        await video.play();
      } else {
        video.pause();
      }
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
      showNotice(
        "Your browser paused automatic playback. Select Enable playback once.",
        "info"
      );
    }

    window.setTimeout(() => {
      isRemoteUpdate.current = false;
    }, 350);
  }

  function enterRoom(response, nextName, { preserveChat = false } = {}) {
    if (!response?.room) return;

    adoptParticipantId(response.participantId);

    const nextRoomId = response.room.roomId;
    const assignedParticipantId =
      response.participantId || participantIdRef.current;
    const me = response.room.users?.find(
      (user) => user.participantId === assignedParticipantId
    );

    setJoinedRoom(nextRoomId);
    setRoomId(nextRoomId);
    setName(nextName);
    setReady(Boolean(me?.ready));
    setCountdown(null);
    setLastEvent(`Connected to ${nextRoomId}`);
    setAutoplayBlocked(false);
    clearNotice();

    if (!preserveChat) {
      setChatMessages([]);
    }

    applyRoomState(response.room);
    saveRoomSession(nextRoomId, nextName);
    setRoomPath(nextRoomId);

    window.setTimeout(() => {
      applyPlaybackSnapshot(response.room.playback);
    }, 0);
  }

  function resetRoomState() {
    setJoinedRoom("");
    setReady(false);
    setRoomUsers([]);
    setCountdown(null);
    setChatMessages([]);
    setRoomMovieTitle("");
    setRoomMovieYear("");
    setRoomPlatform("");
    setLastEvent("Waiting for playback");
    setAutoplayBlocked(false);
    clearRoomSession();
    setRoomPath("");
  }

  function validateCommonFields() {
    const trimmedName = name.trim();
    const trimmedRoomId = roomId.trim();

    if (!trimmedName) {
      showNotice("Enter your name.");
      return null;
    }

    if (!/^[A-Za-z0-9_-]{3,40}$/.test(trimmedRoomId)) {
      showNotice(
        "Room codes need 3–40 letters, numbers, underscores, or hyphens."
      );
      return null;
    }

    return { trimmedName, trimmedRoomId };
  }

  function createRoom() {
    const common = validateCommonFields();
    if (!common) return;

    setPending(true);
    clearNotice();

    socket.emit(
      "create-room",
      {
        roomId: common.trimmedRoomId,
        name: common.trimmedName,
        participantId: participantIdRef.current,
      },
      (response) => {
        setPending(false);

        if (!response?.success) {
          showNotice(response?.message || "Could not create the room.");
          return;
        }

        enterRoom(response, common.trimmedName);
      }
    );
  }

  function joinExistingRoom() {
    const common = validateCommonFields();
    if (!common) return;

    setPending(true);
    clearNotice();

    socket.emit(
      "join-room",
      {
        roomId: common.trimmedRoomId,
        name: common.trimmedName,
        participantId: participantIdRef.current,
      },
      (response) => {
        setPending(false);

        if (!response?.success) {
          showNotice(response?.message || "Could not join the room.");
          return;
        }

        enterRoom(response, common.trimmedName);
      }
    );
  }

  async function copyInvite() {
    const inviteRoom = joined ? joinedRoom : roomId.trim();

    if (!inviteRoom) {
      showNotice("Enter a room code first.");
      return;
    }

    const inviteUrl = `${window.location.origin}/room/${encodeURIComponent(
      inviteRoom
    )}`;

    const inviteText = joined
      ? `Join my TogetherScreen room\n\n${roomMovieTitle} (${roomMovieYear})\nRoom: ${inviteRoom}\n${inviteUrl}`
      : `Join my TogetherScreen room\n\nRoom: ${inviteRoom}\n${inviteUrl}`;

    try {
      await navigator.clipboard.writeText(inviteText);
      showNotice("Invite copied.", "success");
    } catch {
      showNotice("Could not copy the invite. Copy the room code manually.");
    }
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(joinedRoom);
      showNotice("Room code copied.", "success");
    } catch {
      showNotice("Could not copy the room code.");
    }
  }

  function leaveRoom() {
    if (!joined) return;

    socket.emit("leave-room", null, () => {
      resetRoomState();
    });
  }

  function endRoom() {
    if (!joined || !isHost) return;

    const confirmed = window.confirm(
      "End this room for everyone? This cannot be undone."
    );
    if (!confirmed) return;

    socket.emit("end-room", { roomId: joinedRoom }, (response) => {
      if (!response?.success) {
        showNotice(response?.message || "Could not end the room.");
      }
    });
  }

  function transferHost(targetParticipantId) {
    socket.emit(
      "transfer-host",
      { roomId: joinedRoom, targetParticipantId },
      (response) => {
        if (!response?.success) {
          showNotice(response?.message || "Could not transfer host controls.");
          return;
        }

        showNotice("Host controls transferred.", "success");
      }
    );
  }

  function toggleReady() {
    if (!joined) return;

    const nextReady = !ready;
    setReady(nextReady);
    clearNotice();

    socket.emit(
      "ready-change",
      { roomId: joinedRoom, ready: nextReady },
      (response) => {
        if (!response?.success) {
          setReady(!nextReady);
          showNotice("Could not update your ready status.");
        }
      }
    );
  }

  function startTogether() {
    const video = videoRef.current;
    if (!joined || !video || !isHost) return;

    socket.emit(
      "start-together",
      { roomId: joinedRoom, time: video.currentTime },
      (response) => {
        if (!response?.success) {
          showNotice(response?.message || "Could not start the room.");
          return;
        }

        clearNotice();
        setLastEvent("Playback scheduled for everyone");
      }
    );
  }

  function sendChatMessage() {
    if (!joined) return;

    const trimmedMessage = chatInput.trim();
    if (!trimmedMessage) return;

    socket.emit(
      "chat-message",
      { roomId: joinedRoom, message: trimmedMessage },
      (response) => {
        if (!response?.success) {
          showNotice("Message could not be sent.");
        }
      }
    );

    setChatInput("");
  }

  function sendVideoEvent(type) {
    const video = videoRef.current;

    if (!video || !joined || !isHost || isRemoteUpdate.current) {
      return;
    }

    socket.emit("video-event", {
      roomId: joinedRoom,
      type,
      time: video.currentTime,
      isPlaying: !video.paused,
    });

    setLastEvent(
      `${type[0].toUpperCase()}${type.slice(1)} · ${video.currentTime.toFixed(
        1
      )}s`
    );
  }

  async function applyRemoteVideoEvent(event) {
    const video = videoRef.current;
    if (!video) return;

    isRemoteUpdate.current = true;
    setLastEvent(
      `Synced ${event.type} · ${Number(event.time).toFixed(1)}s`
    );

    if (Math.abs(video.currentTime - event.time) > 0.15) {
      video.currentTime = event.time;
    }

    try {
      if (event.type === "play" || event.isPlaying) {
        await video.play();
      } else {
        video.pause();
      }
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
    }

    window.setTimeout(() => {
      isRemoteUpdate.current = false;
    }, 350);
  }

  async function enablePlayback() {
    const video = videoRef.current;
    if (!video) return;

    try {
      await video.play();
      setAutoplayBlocked(false);
      showNotice("Playback enabled for this tab.", "success");
    } catch {
      showNotice("Click directly on the video, then try again.");
    }
  }

  function runCountdownAndPlay(videoTime, startAt) {
    const video = videoRef.current;
    if (!video) return;

    if (countdownTimer.current) {
      window.clearInterval(countdownTimer.current);
    }

    const updateCountdown = async () => {
      const millisecondsRemaining = startAt - Date.now();

      if (millisecondsRemaining > 0) {
        setCountdown(Math.max(1, Math.ceil(millisecondsRemaining / 1000)));
        return;
      }

      window.clearInterval(countdownTimer.current);
      countdownTimer.current = null;
      setCountdown("PLAY");
      isRemoteUpdate.current = true;
      video.currentTime = videoTime;

      try {
        await video.play();
        setAutoplayBlocked(false);
      } catch {
        setAutoplayBlocked(true);
      }

      window.setTimeout(() => {
        setCountdown(null);
        isRemoteUpdate.current = false;
      }, 650);
    };

    updateCountdown();
    countdownTimer.current = window.setInterval(updateCountdown, 100);
  }

  useEffect(() => {
    function handleConnect() {
      setConnected(true);
      setReconnecting(false);

      const savedSession = sessionStorage.getItem(ROOM_SESSION_KEY);
      if (!savedSession) return;

      try {
        const parsed = JSON.parse(savedSession);

        socket.emit(
          "rejoin-room",
          {
            ...parsed,
            participantId: participantIdRef.current,
          },
          (response) => {
            if (!response?.success) {
              clearRoomSession();
              resetRoomState();
              showNotice(
                response?.message || "The previous room is no longer available."
              );
              return;
            }

            enterRoom(response, parsed.name, { preserveChat: true });
            showNotice("Reconnected to your room.", "success");
          }
        );
      } catch {
        clearRoomSession();
      }
    }

    function handleDisconnect() {
      setConnected(false);
      setReconnecting(Boolean(sessionStorage.getItem(ROOM_SESSION_KEY)));
    }

    function handleConnectError() {
      setConnected(false);
      setReconnecting(Boolean(sessionStorage.getItem(ROOM_SESSION_KEY)));
    }

    function handleRoomStatus(status) {
      applyRoomState(status);

      const me = status.users?.find(
        (user) => user.participantId === participantIdRef.current
      );
      if (me) setReady(Boolean(me.ready));
    }

    function handleRoomClosed(payload) {
      resetRoomState();
      showNotice(payload?.message || "The room was closed.", "info");
    }

    function handleChatMessage(chatMessage) {
      if (!chatMessage?.id) return;
      mergeMessages([chatMessage]);
    }

    function handleVideoEvent(event) {
      applyRemoteVideoEvent(event);
    }

    function handleSyncState(event) {
      const video = videoRef.current;
      if (!video || isHostRef.current) return;

      const difference = Math.abs(video.currentTime - event.time);
      const playingStateDiffers = event.isPlaying === video.paused;

      if (difference > 0.5 || playingStateDiffers) {
        applyRemoteVideoEvent({
          type: event.isPlaying ? "play" : "pause",
          time: event.time,
          isPlaying: event.isPlaying,
        });
      }
    }

    function handleStartTogether(event) {
      clearNotice();
      setLastEvent(`Starting from ${event.videoTime.toFixed(1)}s`);
      runCountdownAndPlay(event.videoTime, event.startAt);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("room-status", handleRoomStatus);
    socket.on("room-closed", handleRoomClosed);
    socket.on("chat-message", handleChatMessage);
    socket.on("video-event", handleVideoEvent);
    socket.on("sync-state", handleSyncState);
    socket.on("start-together", handleStartTogether);

    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room-status", handleRoomStatus);
      socket.off("room-closed", handleRoomClosed);
      socket.off("chat-message", handleChatMessage);
      socket.off("video-event", handleVideoEvent);
      socket.off("sync-state", handleSyncState);
      socket.off("start-together", handleStartTogether);

      if (countdownTimer.current) {
        window.clearInterval(countdownTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!joined || !isHost) return undefined;

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !socket.connected) return;

      socket.emit("sync-state", {
        roomId: joinedRoom,
        time: video.currentTime,
        isPlaying: !video.paused,
      });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [joined, joinedRoom, isHost]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          type="button"
          className="brand"
          onClick={() => {
            if (!joined) setRoomPath("");
          }}
          aria-label="TogetherScreen home"
        >
          <img
            src={togetherScreenLogo}
            alt=""
            className="brand-logo-image"
            aria-hidden="true"
            draggable="false"
          />
        </button>

        <div
          className="header-status"
          aria-live="polite"
          aria-label={connected ? "Connected" : "Offline"}
          title={connected ? "Connected" : "Offline"}
        >
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
        </div>
      </header>

      {reconnecting && (
        <div className="connection-banner" role="status">
          <span className="spinner" /> Reconnecting to your watch party…
        </div>
      )}

      {!joined ? (
        <main className="landing-page">
          <section className="landing-hero landing-hero-centered">
            <div className="hero-network-bg" aria-hidden="true">
              <img
                src={worldMapBase}
                alt=""
                className="hero-background-base"
                draggable="false"
              />
              <img
                src={worldNetworkLines}
                alt=""
                className="hero-background-lines"
                draggable="false"
              />
              <div className="hero-overlay" />
            </div>

            <div className="hero-copy hero-copy-centered">
              <p className="eyebrow">REAL-TIME WATCH PARTIES</p>
              <h1>Watch together, and make distance feel smaller.</h1>
              <p className="hero-description">
                Ready to start? Create a room or join one with a code.
              </p>

            </div>
          </section>

          <section className="setup-card">
            <div className="setup-heading">
              <div>
                <p className="section-kicker">START WATCHING</p>
                <h2>{roomMode === "create" ? "Create a room" : "Join a room"}</h2>
              </div>
              <div className="mode-switch" role="tablist">
                <button
                  type="button"
                  className={roomMode === "create" ? "active" : ""}
                  onClick={() => {
                    setRoomMode("create");
                    clearNotice();
                  }}
                  disabled={pending}
                >
                  Create
                </button>
                <button
                  type="button"
                  className={roomMode === "join" ? "active" : ""}
                  onClick={() => {
                    setRoomMode("join");
                    clearNotice();
                  }}
                  disabled={pending}
                >
                  Join
                </button>
              </div>
            </div>

            <div className="form-stack">
              <label className="floating-field">
                <input
                  value={name}
                  maxLength={30}
                  onChange={(event) => setName(event.target.value)}
                  placeholder=" "
                  autoComplete="name"
                  disabled={pending}
                />
                <span className="floating-label">Name</span>
              </label>

              <div className="floating-field-with-action">
                <label className="floating-field">
                  <input
                    value={roomId}
                    maxLength={40}
                    onChange={(event) => setRoomId(event.target.value)}
                    placeholder=" "
                    disabled={pending}
                  />
                  <span className="floating-label">Room code</span>
                </label>
                {roomMode === "create" && (
                  <button
                    type="button"
                    className={`input-action generate-button ${
                      codeGenerated ? "generated" : ""
                    }`}
                    onClick={handleGenerateRoomCode}
                    disabled={pending}
                  >
                    {codeGenerated ? "Generated" : "Generate"}
                  </button>
                )}
              </div>

              <button
                type="button"
                className="primary-cta"
                onClick={roomMode === "create" ? createRoom : joinExistingRoom}
                disabled={pending}
              >
                {pending
                  ? roomMode === "create"
                    ? "Creating room…"
                    : "Joining room…"
                  : roomMode === "create"
                    ? "Create private room"
                    : "Join room"}
              </button>
            </div>

            {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}

            <p className="setup-footnote">
              Create a room, share the code, and bring everyone into one synchronized
              watch party. TogetherScreen is designed for simple, private, and
              long-distance movie nights.
            </p>
          </section>

          <section className="landing-explain">
            <div className="section-heading">
              <p className="section-kicker">WHY TOGETHERSCREEN</p>
              <h2>One room. One timeline. Everyone together.</h2>
            </div>

            <div className="why-grid">
              {WHY_FEATURES.map((feature) => (
                <article className="why-card" key={feature.title}>
                  <div className="why-card-copy">
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                  </div>
                  <div className="why-card-icon" aria-hidden="true">
                    <FeatureIcon type={feature.icon} />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="landing-faq">
            <div className="faq-heading">
              <h2>Frequently Asked Questions</h2>
            </div>

            <div className="faq-list">
              {FAQ_ITEMS.map((item) => (
                <details className="faq-item" key={item.question}>
                  <summary>
                    <span>{item.question}</span>
                    <span className="faq-symbol" aria-hidden="true">+</span>
                  </summary>
                  <div className="faq-answer">
                    <p>{item.answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </main>
      ) : (
        <main className="room-page">
          <section className="room-hero">
            <div className="room-title-block">
              <div className="live-pill">
                <span /> LIVE WATCH PARTY
              </div>
              <h1>{roomMovieTitle}</h1>
              <p>Hosted by {hostUser?.name || "—"}</p>
            </div>

            <div className="room-top-actions">
              <button type="button" className="room-code" onClick={copyRoomCode}>
                <small>ROOM CODE</small>
                <strong>{joinedRoom}</strong>
                <span>Copy</span>
              </button>
              <button type="button" className="button ghost" onClick={copyInvite}>
                Invite
              </button>
              {isHost ? (
                <button type="button" className="button danger" onClick={endRoom}>
                  End room
                </button>
              ) : (
                <button type="button" className="button ghost" onClick={leaveRoom}>
                  Leave
                </button>
              )}
            </div>
          </section>

          <section className="status-grid" aria-label="Room status">
            <article>
              <span className="status-icon">●</span>
              <div>
                <small>CONNECTED</small>
                <strong>{connectedUsers.length} viewers</strong>
              </div>
            </article>
            <article>
              <span className="status-icon">✓</span>
              <div>
                <small>READY</small>
                <strong>
                  {readyCount}/{connectedUsers.length}
                </strong>
              </div>
            </article>
            <article>
              <span className="status-icon">◆</span>
              <div>
                <small>YOUR ROLE</small>
                <strong>{isHost ? "Host" : "Viewer"}</strong>
              </div>
            </article>
            <article>
              <span className="status-icon">↻</span>
              <div>
                <small>SYNC STATUS</small>
                <strong>{connected ? "Live" : "Reconnecting"}</strong>
              </div>
            </article>
          </section>

          {notice.text && (
            <div className={`notice room-notice ${notice.type || "error"}`} role="status">
              {notice.text}
            </div>
          )}

          <section className="watch-grid">
            <div className="player-column">
              <div className="video-shell">
                <video
                  ref={videoRef}
                  controls={isHost}
                  playsInline
                  preload="metadata"
                  onPlay={() => sendVideoEvent("play")}
                  onPause={() => sendVideoEvent("pause")}
                  onSeeked={() => sendVideoEvent("seek")}
                >
                  <source src={DEMO_VIDEO_URL} type="video/mp4" />
                </video>

                <div className="video-top-overlay">
                  <span className="sync-badge">SYNCHRONIZED</span>
                  <span>{isHost ? "Host controls" : "Following host"}</span>
                </div>

                {!isHost && !autoplayBlocked && (
                  <div className="viewer-overlay">
                    <span>Playback is controlled by {hostUser?.name || "the host"}</span>
                  </div>
                )}

                {autoplayBlocked && (
                  <div className="playback-permission">
                    <p>Your browser needs permission to play synchronized video.</p>
                    <button type="button" onClick={enablePlayback}>
                      Enable playback
                    </button>
                  </div>
                )}

                {countdown !== null && (
                  <div className="countdown-overlay">
                    <span>{countdown}</span>
                  </div>
                )}
              </div>

              <div className="player-control-card">
                <div className="playback-copy">
                  <small>NOW PLAYING</small>
                  <strong>{roomMovieTitle}</strong>
                  <span>{lastEvent}</span>
                </div>

                <div className="playback-actions">
                  <button
                    type="button"
                    className={`button ${ready ? "ready-active" : "secondary"}`}
                    onClick={toggleReady}
                  >
                    {ready ? "Ready ✓" : "I’m ready"}
                  </button>

                  {isHost && (
                    <button
                      type="button"
                      className="button primary"
                      onClick={startTogether}
                      disabled={!everyoneReady}
                      title={
                        everyoneReady
                          ? "Start synchronized playback"
                          : "At least two connected viewers must be ready"
                      }
                    >
                      Start together
                    </button>
                  )}
                </div>
              </div>

              {!everyoneReady && (
                <p className="readiness-note">
                  {connectedUsers.length < 2
                    ? "Invite one more person to begin."
                    : `Waiting for ${connectedUsers.length - readyCount} viewer${
                        connectedUsers.length - readyCount === 1 ? "" : "s"
                      } to get ready.`}
                </p>
              )}
            </div>

            <aside className="social-panel">
              <section className="members-section">
                <div className="panel-heading">
                  <div>
                    <small>WATCHING NOW</small>
                    <h2>Room members</h2>
                  </div>
                  <span className="member-count">{connectedUsers.length}</span>
                </div>

                <div className="member-list">
                  {roomUsers.map((user) => (
                    <div
                      className={`member-row ${!user.connected ? "member-offline" : ""}`}
                      key={user.participantId}
                    >
                      <div className="avatar">{getInitials(user.name)}</div>
                      <div className="member-copy">
                        <strong>
                          {user.name}
                          {user.participantId === participantId && " (You)"}
                        </strong>
                        <span>
                          {user.isHost ? "Host" : user.connected ? "Viewer" : "Reconnecting"}
                        </span>
                      </div>

                      <div className="member-actions">
                        <span className={`ready-state ${user.ready ? "is-ready" : ""}`}>
                          {user.ready ? "Ready" : "Not ready"}
                        </span>
                        {isHost &&
                          !user.isHost &&
                          user.connected &&
                          user.participantId !== participantId && (
                            <button
                              type="button"
                              className="promote-button"
                              onClick={() => transferHost(user.participantId)}
                            >
                              Make host
                            </button>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="chat-section">
                <div className="panel-heading chat-heading">
                  <div>
                    <small>LIVE CONVERSATION</small>
                    <h2>Chat</h2>
                  </div>
                </div>

                <div className="chat-messages" aria-live="polite">
                  {chatMessages.length === 0 ? (
                    <div className="empty-chat">
                      <span>✦</span>
                      <p>No messages yet. Say hello.</p>
                    </div>
                  ) : (
                    chatMessages.map((chatMessage) => {
                      if (chatMessage.type === "system") {
                        return (
                          <div className="system-message" key={chatMessage.id}>
                            {chatMessage.message}
                          </div>
                        );
                      }

                      const isMine =
                        chatMessage.senderParticipantId === participantId;

                      return (
                        <div
                          className={`message-row ${isMine ? "mine" : "theirs"}`}
                          key={chatMessage.id}
                        >
                          <div className="message-bubble">
                            <div className="message-meta">
                              <strong>{isMine ? "You" : chatMessage.senderName}</strong>
                              <span>{formatMessageTime(chatMessage.sentAt)}</span>
                            </div>
                            <p>{chatMessage.message}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="chat-input-row">
                  <input
                    value={chatInput}
                    maxLength={500}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendChatMessage();
                      }
                    }}
                    placeholder="Message the room"
                    aria-label="Chat message"
                  />
                  <button
                    type="button"
                    onClick={sendChatMessage}
                    disabled={!chatInput.trim()}
                    aria-label="Send message"
                  >
                    Send
                  </button>
                </div>
              </section>
            </aside>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
