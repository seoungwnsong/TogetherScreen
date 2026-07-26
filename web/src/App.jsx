import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io("http://localhost:3001");

function App() {
  const videoRef = useRef(null);

  const [name, setName] = useState("Seoungwan");
  const [roomId, setRoomId] = useState("test-room");
  const [roomMode, setRoomMode] = useState(null);

  const [movieTitle, setMovieTitle] = useState("La La Land");
  const [movieYear, setMovieYear] = useState("2016");
  const [platform, setPlatform] = useState("Netflix");

  const [roomMovieTitle, setRoomMovieTitle] = useState("");
  const [roomMovieYear, setRoomMovieYear] = useState("");
  const [roomPlatform, setRoomPlatform] = useState("");

  const [joinedRoom, setJoinedRoom] = useState("");
  const [connected, setConnected] = useState(socket.connected);
  const [lastEvent, setLastEvent] = useState("None yet");
  const [ready, setReady] = useState(false);
  const [roomUsers, setRoomUsers] = useState([]);
  const [message, setMessage] = useState("");
  const [countdown, setCountdown] = useState(null);

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);

  const isRemoteUpdate = useRef(false);
  const joined = joinedRoom !== "";

  function resetRoomStateAfterRequest(trimmedRoomId, eventLabel) {
    setJoinedRoom(trimmedRoomId);
    setReady(false);
    setRoomUsers([]);
    setMessage("");
    setCountdown(null);
    setChatMessages([]);
    setLastEvent(`${eventLabel}: ${trimmedRoomId}`);
  }

  function createRoom() {
    const trimmedRoomId = roomId.trim();
    const trimmedName = name.trim();
    const trimmedMovieTitle = movieTitle.trim();
    const trimmedMovieYear = movieYear.trim();
    const trimmedPlatform = platform.trim();

    if (trimmedName === "") {
      setMessage("Name cannot be empty.");
      return;
    }

    if (trimmedRoomId === "") {
      setMessage("Room name cannot be empty.");
      return;
    }

    if (trimmedMovieTitle === "") {
      setMessage("Movie title cannot be empty.");
      return;
    }

    if (trimmedMovieYear === "") {
      setMessage("Movie year cannot be empty.");
      return;
    }

    if (trimmedPlatform === "") {
      setMessage("Platform cannot be empty.");
      return;
    }

    socket.emit("create-room", {
      roomId: trimmedRoomId,
      name: trimmedName,
      movieTitle: trimmedMovieTitle,
      movieYear: trimmedMovieYear,
      platform: trimmedPlatform,
    });

    resetRoomStateAfterRequest(trimmedRoomId, "Create room request");
  }

  function joinExistingRoom() {
    const trimmedRoomId = roomId.trim();
    const trimmedName = name.trim();

    if (trimmedName === "") {
      setMessage("Name cannot be empty.");
      return;
    }

    if (trimmedRoomId === "") {
      setMessage("Room name cannot be empty.");
      return;
    }

    socket.emit("join-room", {
      roomId: trimmedRoomId,
      name: trimmedName,
    });

    resetRoomStateAfterRequest(trimmedRoomId, "Join room request");
  }

  async function copyInvite() {
    const inviteRoom = joined ? joinedRoom : roomId;
    const inviteMovieTitle = joined ? roomMovieTitle : movieTitle;
    const inviteMovieYear = joined ? roomMovieYear : movieYear;
    const invitePlatform = joined ? roomPlatform : platform;

    const inviteText = `Join my TogetherScreen room!

Room: ${inviteRoom}
Movie: ${inviteMovieTitle} (${inviteMovieYear})
Platform: ${invitePlatform}

Open: http://localhost:5173/`;

    try {
      await navigator.clipboard.writeText(inviteText);
      setMessage("Invite copied to clipboard!");
    } catch (error) {
      setMessage("Could not copy invite. Please copy it manually.");
    }
  }

  function leaveRoom() {
    if (!joined) {
      return;
    }

    socket.emit("leave-room");

    setJoinedRoom("");
    setReady(false);
    setRoomUsers([]);
    setMessage("");
    setCountdown(null);
    setChatMessages([]);
    setRoomMovieTitle("");
    setRoomMovieYear("");
    setRoomPlatform("");
    setLastEvent("Left room");
  }

  function toggleReady() {
    if (!joined) {
      setMessage("Join a room first.");
      return;
    }

    const newReady = !ready;
    setReady(newReady);
    setMessage("");

    socket.emit("ready-change", {
      roomId: joinedRoom,
      ready: newReady,
    });

    setLastEvent(newReady ? "You are ready" : "You are not ready");
  }

  function startTogether() {
    if (!joined) {
      setMessage("Join a room first.");
      return;
    }

    socket.emit("start-together", {
      roomId: joinedRoom,
      time: 0,
    });

    setLastEvent("Sent: start together request");
  }

  function sendChatMessage() {
    if (!joined) {
      setMessage("Join a room first.");
      return;
    }

    const trimmedMessage = chatInput.trim();

    if (trimmedMessage === "") {
      return;
    }

    socket.emit("chat-message", {
      roomId: joinedRoom,
      message: trimmedMessage,
    });

    setChatInput("");
  }

  function sendVideoEvent(type) {
    const video = videoRef.current;

    if (!video || !joined || isRemoteUpdate.current) {
      return;
    }

    const event = {
      roomId: joinedRoom,
      type,
      time: video.currentTime,
    };

    socket.emit("video-event", event);
    setLastEvent(`Sent: ${type} at ${video.currentTime.toFixed(2)}s`);
  }

  function runCountdownAndPlay(startTime) {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    setCountdown(3);

    setTimeout(() => {
      setCountdown(2);
    }, 1000);

    setTimeout(() => {
      setCountdown(1);
    }, 2000);

    setTimeout(async () => {
      setCountdown("Play!");

      isRemoteUpdate.current = true;

      video.currentTime = startTime;
      await video.play();

      setTimeout(() => {
        setCountdown(null);
        isRemoteUpdate.current = false;
      }, 500);
    }, 3000);
  }

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("room-status", (status) => {
      setRoomUsers(status.users);
      setRoomMovieTitle(status.movieTitle);
      setRoomMovieYear(status.movieYear);
      setRoomPlatform(status.platform);
    });

    socket.on("room-error", (error) => {
      setMessage(error.message);
      setJoinedRoom("");
      setReady(false);
      setRoomUsers([]);
      setRoomMovieTitle("");
      setRoomMovieYear("");
      setRoomPlatform("");
    });

    socket.on("start-error", (error) => {
      setMessage(error.message);
      setLastEvent(`Start blocked: ${error.message}`);
    });

    socket.on("chat-message", (chatMessage) => {
      setChatMessages((previousMessages) => [
        ...previousMessages,
        chatMessage,
      ]);
    });

    socket.on("video-event", async (event) => {
      const video = videoRef.current;

      if (!video) {
        return;
      }

      setLastEvent(`Received: ${event.type} at ${event.time.toFixed(2)}s`);

      isRemoteUpdate.current = true;

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
        isRemoteUpdate.current = false;
      }, 500);
    });

    socket.on("start-together", (event) => {
      setMessage("");
      setLastEvent(`Received: start together at ${event.time}s`);
      runCountdownAndPlay(event.time);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("room-status");
      socket.off("room-error");
      socket.off("start-error");
      socket.off("chat-message");
      socket.off("video-event");
      socket.off("start-together");
    };
  }, []);

  const everyoneReady =
    roomUsers.length >= 2 && roomUsers.every((user) => user.ready);

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">LONG-DISTANCE MOVIE NIGHT</p>
        <h1>TogetherScreen</h1>
        <p className="subtitle">Watch together, stay connected together.</p>
      </header>

      {!joined && (
        <section className="panel setup-panel">
          <div className="setup-header">
            <p className="label">CREATE OR JOIN A ROOM</p>
            <h2>Set up your movie night</h2>
          </div>

          <div className="mode-panel">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />

            <div className="mode-buttons">
              <button
                className={
                  roomMode === "create" ? "primary-button" : "secondary-button"
                }
                onClick={() => {
                  setRoomMode("create");
                  setMessage("");
                }}
              >
                Create Room
              </button>

              <button
                className={
                  roomMode === "join" ? "primary-button" : "secondary-button"
                }
                onClick={() => {
                  setRoomMode("join");
                  setMessage("");
                }}
              >
                Join Room
              </button>
            </div>
          </div>

          {roomMode === "create" && (
            <div className="form-grid">
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Room ID"
              />

              <input
                value={movieTitle}
                onChange={(e) => setMovieTitle(e.target.value)}
                placeholder="Movie title"
              />

              <input
                value={movieYear}
                onChange={(e) => setMovieYear(e.target.value)}
                placeholder="Year"
              />

              <input
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="Platform"
              />

              <button className="primary-button" onClick={createRoom}>
                Create Room
              </button>

              <button className="secondary-button" onClick={copyInvite}>
                Copy Invite
              </button>
            </div>
          )}

          {roomMode === "join" && (
            <div className="join-grid">
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Room ID"
              />

              <button className="primary-button" onClick={joinExistingRoom}>
                Join Room
              </button>
            </div>
          )}

          {message && (
            <p className={message.includes("copied") ? "success" : "error"}>
              {message}
            </p>
          )}
        </section>
      )}

      {joined && (
        <>
          <section className="panel room-panel">
            <div className="room-summary compact">
              <div>
                <p className="label">Room</p>
                <h2>{joinedRoom}</h2>
              </div>

              <div>
                <p className="label">Watching</p>
                <h2>
                  {roomMovieTitle} ({roomMovieYear})
                </h2>
              </div>

              <div>
                <p className="label">Platform</p>
                <h2>{roomPlatform}</h2>
              </div>

              <div className="room-actions">
                <button className="secondary-button" onClick={copyInvite}>
                  Copy Invite
                </button>

                <button className="danger-button" onClick={leaveRoom}>
                  Leave Room
                </button>
              </div>
            </div>

            {message && (
              <p className={message.includes("copied") ? "success" : "error"}>
                {message}
              </p>
            )}
          </section>

          <section className="panel control-panel">
            <div>
              <p className="label">Your status</p>
              <h3>{ready ? "Ready" : "Not ready"}</h3>
            </div>

            <div>
              <p className="label">Everyone ready</p>
              <h3>{everyoneReady ? "Yes" : "No"}</h3>
            </div>

            <div>
              <p className="label">People in room</p>
              <h3>{roomUsers.length}</h3>
            </div>

            <div className="control-buttons">
              <button className="secondary-button" onClick={toggleReady}>
                {ready ? "Cancel Ready" : "Ready"}
              </button>

              <button className="primary-button" onClick={startTogether}>
                Start Together
              </button>
            </div>
          </section>

          <main className="watch-layout">
            <section className="video-card">
              <div className="video-wrapper">
                <video
                  ref={videoRef}
                  controls
                  onPlay={() => sendVideoEvent("play")}
                  onPause={() => sendVideoEvent("pause")}
                  onSeeked={() => sendVideoEvent("seek")}
                >
                  <source
                    src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
                    type="video/mp4"
                  />
                </video>

                {countdown !== null && (
                  <div className="countdown-overlay">{countdown}</div>
                )}
              </div>

              <p className="last-event">Last event: {lastEvent}</p>
            </section>

            <aside className="chat-card">
              <div className="chat-header">
                <p className="label">Room members</p>
                <h2>Chat</h2>
              </div>

              <div className="member-list">
                {roomUsers.map((user) => (
                  <div className="member" key={user.socketId}>
                    <span>{user.name}</span>
                    <span
                      className={user.ready ? "ready-pill" : "not-ready-pill"}
                    >
                      {user.ready ? "Ready" : "Not ready"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="chat-messages">
                {chatMessages.length === 0 ? (
                  <p className="muted">No messages yet.</p>
                ) : (
                  chatMessages.map((chatMessage, index) => {
                    const isMine = chatMessage.senderName === name;

                    return (
                      <div
                        className={
                          isMine ? "message-row mine" : "message-row theirs"
                        }
                        key={index}
                      >
                        <div className="message-bubble">
                          <p className="message-sender">
                            {chatMessage.senderName}
                          </p>
                          <p className="message-text">{chatMessage.message}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="chat-input-row">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      sendChatMessage();
                    }
                  }}
                  placeholder="Type a message..."
                />

                <button className="primary-button" onClick={sendChatMessage}>
                  Send
                </button>
              </div>
            </aside>
          </main>
        </>
      )}

      <div className="server-status-small">
        <span className={connected ? "dot connected" : "dot disconnected"} />
      </div>
    </div>
  );
}

export default App;