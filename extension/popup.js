"use strict";

const CONFIG = globalThis.TOGETHER_SCREEN_CONFIG;
const FORM_STORAGE_KEY = "togetherScreenExtensionForm";

const elements = {
  connectionDot: document.getElementById("connectionDot"),
  videoStatusTitle: document.getElementById("videoStatusTitle"),
  videoStatusDetail: document.getElementById("videoStatusDetail"),
  rescanButton: document.getElementById("rescanButton"),
  setupView: document.getElementById("setupView"),
  roomView: document.getElementById("roomView"),
  createModeButton: document.getElementById("createModeButton"),
  joinModeButton: document.getElementById("joinModeButton"),
  nameInput: document.getElementById("nameInput"),
  roomInput: document.getElementById("roomInput"),
  generateButton: document.getElementById("generateButton"),
  submitButton: document.getElementById("submitButton"),
  setupMessage: document.getElementById("setupMessage"),
  joinedRoomCode: document.getElementById("joinedRoomCode"),
  roleBadge: document.getElementById("roleBadge"),
  peopleCount: document.getElementById("peopleCount"),
  readyCount: document.getElementById("readyCount"),
  yourStatus: document.getElementById("yourStatus"),
  memberList: document.getElementById("memberList"),
  readyButton: document.getElementById("readyButton"),
  startButton: document.getElementById("startButton"),
  copyInviteButton: document.getElementById("copyInviteButton"),
  leaveButton: document.getElementById("leaveButton"),
  roomMessage: document.getElementById("roomMessage"),
  lastEvent: document.getElementById("lastEvent"),
};

let mode = "create";
let activeTabId = null;
let latestState = null;
let pollingTimer = null;

function makeRoomCode() {
  const first = ["night", "movie", "screen", "watch", "cinema"];
  const second = ["room", "club", "party", "lounge", "date"];
  const number = Math.floor(100 + Math.random() * 900);
  return `${first[Math.floor(Math.random() * first.length)]}-${
    second[Math.floor(Math.random() * second.length)]
  }-${number}`;
}

function showMessage(element, message = "", type = "error") {
  element.textContent = message;
  element.classList.toggle("success", type === "success");
}

function setPending(pending) {
  for (const element of [
    elements.createModeButton,
    elements.joinModeButton,
    elements.nameInput,
    elements.roomInput,
    elements.generateButton,
    elements.submitButton,
    elements.readyButton,
    elements.startButton,
    elements.leaveButton,
    elements.rescanButton,
  ]) {
    element.disabled = pending;
  }
}

function setMode(nextMode) {
  mode = nextMode;
  elements.createModeButton.classList.toggle("active", mode === "create");
  elements.joinModeButton.classList.toggle("active", mode === "join");
  elements.generateButton.hidden = mode !== "create";
  elements.submitButton.textContent = mode === "create" ? "Create room" : "Join room";
  showMessage(elements.setupMessage);
}

function renderVideo(video = {}) {
  if (video.found) {
    elements.videoStatusTitle.textContent = "Video detected";
    elements.videoStatusDetail.textContent = video.title || "HTML5 video ready";
  } else {
    elements.videoStatusTitle.textContent = "No video detected";
    elements.videoStatusDetail.textContent = "Open a page with a visible HTML5 video.";
  }
}

function renderMembers(users = []) {
  elements.memberList.replaceChildren();

  for (const user of users) {
    const item = document.createElement("div");
    item.className = "member";

    const name = document.createElement("span");
    name.textContent = `${user.name}${user.isHost ? " · Host" : ""}`;

    const status = document.createElement("span");
    status.textContent = user.ready ? "Ready" : "Not ready";

    item.append(name, status);
    elements.memberList.appendChild(item);
  }
}

function render(state) {
  latestState = state;
  elements.connectionDot.classList.toggle("online", Boolean(state.connected));
  elements.connectionDot.title = state.connected ? "Connected" : "Offline";
  renderVideo(state.video);
  elements.lastEvent.textContent = state.lastEvent || "Waiting for a video tab";

  elements.setupView.classList.toggle("hidden", Boolean(state.joined));
  elements.roomView.classList.toggle("hidden", !state.joined);

  if (!state.joined) {
    if (state.error) showMessage(elements.setupMessage, state.error);
    return;
  }

  elements.joinedRoomCode.textContent = state.roomId;
  elements.roleBadge.textContent = state.isHost ? "Host" : "Viewer";
  elements.peopleCount.textContent = String(state.userCount);
  elements.readyCount.textContent = `${state.readyCount}/${state.userCount}`;
  elements.yourStatus.textContent = state.ready ? "Ready" : "Not ready";
  elements.readyButton.textContent = state.ready ? "Cancel ready" : "Ready";
  elements.startButton.disabled = !state.isHost || !state.everyoneReady || !state.video?.found;
  elements.startButton.title = state.isHost
    ? state.everyoneReady
      ? state.video?.found
        ? "Start synchronized playback"
        : "No video detected"
      : "Everyone must be ready"
    : "Only the host can start";
  renderMembers(state.users);

  if (state.error) showMessage(elements.roomMessage, state.error);
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadState() {
  const response = await send({ type: "TS_GET_STATE", tabId: activeTabId });
  if (response?.state) render(response.state);
}

async function saveForm() {
  await chrome.storage.local.set({
    [FORM_STORAGE_KEY]: {
      name: elements.nameInput.value,
      roomId: elements.roomInput.value,
      mode,
    },
  });
}

async function submitRoom() {
  setPending(true);
  showMessage(elements.setupMessage);

  try {
    await saveForm();
    const response = await send({
      type: mode === "create" ? "TS_CREATE_ROOM" : "TS_JOIN_ROOM",
      tabId: activeTabId,
      name: elements.nameInput.value,
      roomId: elements.roomInput.value,
    });

    if (!response?.success) {
      showMessage(elements.setupMessage, response?.message || "Could not join the room.");
      return;
    }

    render(response.state);
  } catch (error) {
    showMessage(elements.setupMessage, error.message || "Extension request failed.");
  } finally {
    setPending(false);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  const stored = await chrome.storage.local.get(FORM_STORAGE_KEY);
  const form = stored[FORM_STORAGE_KEY];
  if (form) {
    elements.nameInput.value = form.name || "";
    elements.roomInput.value = form.roomId || "";
    setMode(form.mode === "join" ? "join" : "create");
  } else {
    setMode("create");
  }

  await loadState();
  pollingTimer = setInterval(loadState, 1000);
}

elements.createModeButton.addEventListener("click", () => setMode("create"));
elements.joinModeButton.addEventListener("click", () => setMode("join"));
elements.generateButton.addEventListener("click", () => {
  elements.roomInput.value = makeRoomCode();
  elements.roomInput.focus();
});
elements.submitButton.addEventListener("click", submitRoom);
elements.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitRoom();
});
elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitRoom();
});

elements.rescanButton.addEventListener("click", async () => {
  const response = await send({ type: "TS_RESCAN_VIDEO", tabId: activeTabId });
  if (response?.state) render(response.state);
});

elements.readyButton.addEventListener("click", async () => {
  const response = await send({ type: "TS_TOGGLE_READY" });
  if (!response?.success) {
    showMessage(elements.roomMessage, response?.message || "Could not update status.");
  }
  await loadState();
});

elements.startButton.addEventListener("click", async () => {
  setPending(true);
  const response = await send({ type: "TS_START_TOGETHER" });
  setPending(false);

  if (!response?.success) {
    showMessage(elements.roomMessage, response?.message || "Could not start playback.");
  } else {
    showMessage(elements.roomMessage, "Playback scheduled.", "success");
  }
});

elements.copyInviteButton.addEventListener("click", async () => {
  if (!latestState?.roomId) return;

  const inviteUrl = `${CONFIG.WEB_APP_URL}/room/${encodeURIComponent(latestState.roomId)}`;
  await navigator.clipboard.writeText(
    `Join my TogetherScreen room\n\nRoom: ${latestState.roomId}\n${inviteUrl}`
  );
  showMessage(elements.roomMessage, "Invite copied.", "success");
});

elements.leaveButton.addEventListener("click", async () => {
  const response = await send({ type: "TS_LEAVE_ROOM" });
  if (response?.state) render(response.state);
});

window.addEventListener("unload", () => {
  if (pollingTimer) clearInterval(pollingTimer);
});

init().catch((error) => {
  showMessage(elements.setupMessage, error.message || "Could not initialize the extension.");
});
