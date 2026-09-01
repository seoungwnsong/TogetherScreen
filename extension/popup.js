"use strict";

const FORM_STORAGE_KEY = "togetherScreenExtensionForm";

const elements = {
  connectionDot: document.getElementById("connectionDot"),
  videoStatus: document.getElementById("videoStatus"),
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
  memberMenu: document.getElementById("memberMenu"),
  passHostMenuItem: document.getElementById("passHostMenuItem"),
  passHostConfirm: document.getElementById("passHostConfirm"),
  passHostConfirmTitle: document.getElementById("passHostConfirmTitle"),
  passHostCancelButton: document.getElementById("passHostCancelButton"),
  passHostConfirmButton: document.getElementById("passHostConfirmButton"),
  followPrompt: document.getElementById("followPrompt"),
  followPromptTitle: document.getElementById("followPromptTitle"),
  followPromptMessage: document.getElementById("followPromptMessage"),
  followHostButton: document.getElementById("followHostButton"),
  dismissPromptButton: document.getElementById("dismissPromptButton"),
  readyButton: document.getElementById("readyButton"),
  startButton: document.getElementById("startButton"),
  leaveButton: document.getElementById("leaveButton"),
  roomMessage: document.getElementById("roomMessage"),
  lastEvent: document.getElementById("lastEvent"),
};

let mode = "create";
let activeTabId = null;
let latestState = null;
let pollingTimer = null;

// UI-only state for the member row "..." menu and its Pass Host confirmation.
// Neither is server state — both just gate what the popup shows next.
let openMemberMenuId = null;
let menuTargetUser = null;
let pendingHostTransfer = null; // { participantId, name } | null

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

function sanitizeFollowUrl(value) {
  if (typeof value !== "string" || !value) return "";

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderFollowPrompt(prompt) {
  const visible = Boolean(prompt);
  elements.followPrompt.classList.toggle("hidden", !visible);
  if (!visible) return;

  elements.followPromptTitle.textContent = prompt.title;
  elements.followPromptMessage.textContent = prompt.message;
}

function closeMemberMenu() {
  openMemberMenuId = null;
  menuTargetUser = null;
  elements.memberMenu.classList.add("hidden");
}

function openMemberMenuAt(button, user) {
  openMemberMenuId = user.participantId;
  menuTargetUser = user;

  const rect = button.getBoundingClientRect();
  const menuWidth = 132;
  const left = Math.max(
    8,
    Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)
  );

  elements.memberMenu.style.top = `${rect.bottom + 4}px`;
  elements.memberMenu.style.left = `${left}px`;
  elements.memberMenu.classList.remove("hidden");
}

function renderPassHostConfirm() {
  const visible = Boolean(pendingHostTransfer);
  elements.passHostConfirm.classList.toggle("hidden", !visible);
  if (visible) {
    elements.passHostConfirmTitle.textContent = `Pass Host to ${pendingHostTransfer.name}?`;
  }
}

// Only the current host sees a "..." beside every other participant - never
// beside their own row, and never at all for a non-host viewer.
function renderMembers(users = [], isHost = false, myParticipantId = "") {
  elements.memberList.replaceChildren();

  for (const user of users) {
    const item = document.createElement("div");
    item.className = "member";

    const name = document.createElement("span");
    name.textContent = `${user.name}${user.isHost ? " · Host" : ""}`;

    const right = document.createElement("div");
    right.className = "member-right";

    const canPassHostTo =
      isHost && !user.isHost && user.participantId !== myParticipantId;

    if (canPassHostTo) {
      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.className = "member-menu-button";
      menuButton.textContent = "⋯";
      menuButton.setAttribute("aria-label", `Actions for ${user.name}`);
      menuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (openMemberMenuId === user.participantId) {
          closeMemberMenu();
        } else {
          openMemberMenuAt(menuButton, user);
        }
      });
      right.appendChild(menuButton);
    }

    const status = document.createElement("span");
    status.textContent = user.ready ? "Ready" : "Not ready";
    right.appendChild(status);

    item.append(name, right);
    elements.memberList.appendChild(item);
  }
}

function render(state) {
  latestState = state;
  elements.connectionDot.classList.toggle("online", Boolean(state.connected));
  elements.connectionDot.title = state.connected ? "Connected" : "Offline";
  renderVideo(state.video);
  elements.lastEvent.textContent = state.lastEvent || "Waiting for a video tab";

  // The Active Tab card is only meaningful once there's a room to sync
  // against - detection itself keeps running in the background regardless.
  elements.videoStatus.classList.toggle("hidden", !state.joined);

  elements.setupView.classList.toggle("hidden", Boolean(state.joined));
  elements.roomView.classList.toggle("hidden", !state.joined);

  if (!state.joined) {
    elements.followPrompt.classList.add("hidden");
    closeMemberMenu();
    pendingHostTransfer = null;
    renderPassHostConfirm();
    if (state.error) showMessage(elements.setupMessage, state.error);
    return;
  }

  elements.joinedRoomCode.textContent = state.roomId;
  elements.roleBadge.textContent = state.isHost ? "Host" : "Viewer";
  elements.peopleCount.textContent = String(state.userCount);
  elements.readyCount.textContent = `${state.readyCount}/${state.userCount}`;
  elements.yourStatus.textContent = state.ready ? "Ready" : "Not ready";
  elements.readyButton.textContent = state.ready ? "Cancel ready" : "Ready";
  const allMembersReady =
    state.userCount > 0 && state.readyCount === state.userCount;
  elements.startButton.disabled = !state.isHost || !allMembersReady;
  elements.startButton.title = state.isHost
    ? allMembersReady
      ? "Restart every Ready participant's video from 0:00"
      : "Waiting for everyone to be ready"
    : "Only the host can restart together";
  renderMembers(state.users, state.isHost, state.participantId);
  renderFollowPrompt(state.followPrompt);

  // A room-state refresh can invalidate an open menu or pending confirmation
  // (the host lost the role, or the target left) - reconcile before showing.
  if (!state.isHost) {
    closeMemberMenu();
    if (pendingHostTransfer) pendingHostTransfer = null;
  } else if (
    pendingHostTransfer &&
    !state.users.some((user) => user.participantId === pendingHostTransfer.participantId)
  ) {
    pendingHostTransfer = null;
  }
  renderPassHostConfirm();

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
  if (!/^\d{6}$/.test(elements.roomInput.value)) {
    showMessage(elements.setupMessage, "Room code must be 6 digits.");
    return;
  }

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
    elements.roomInput.value = String(form.roomId || "").replace(/\D/g, "").slice(0, 6);
    setMode(form.mode === "join" ? "join" : "create");
  } else {
    setMode("create");
  }

  await loadState();
  pollingTimer = setInterval(loadState, 1000);
}

elements.createModeButton.addEventListener("click", () => setMode("create"));
elements.joinModeButton.addEventListener("click", () => setMode("join"));
elements.generateButton.addEventListener("click", async () => {
  elements.generateButton.disabled = true;
  const response = await send({ type: "TS_GENERATE_ROOM_CODE" });
  elements.generateButton.disabled = false;

  if (response?.success && response.roomId) {
    elements.roomInput.value = response.roomId;
    elements.roomInput.focus();
    showMessage(elements.setupMessage);
    await saveForm();
  } else {
    showMessage(elements.setupMessage, response?.message || "Could not generate a room code.");
  }
});
elements.submitButton.addEventListener("click", submitRoom);
elements.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitRoom();
});
elements.roomInput.addEventListener("input", () => {
  elements.roomInput.value = elements.roomInput.value.replace(/\D/g, "").slice(0, 6);
});
elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitRoom();
});

elements.rescanButton.addEventListener("click", async () => {
  // Restart the spin every click, even if the detected video is unchanged.
  // is-rescanning holds the red accent for the whole animation, independent
  // of hover, so it doesn't drop out if the pointer leaves mid-spin.
  elements.rescanButton.classList.remove("spin", "is-rescanning");
  void elements.rescanButton.offsetWidth;
  elements.rescanButton.classList.add("spin", "is-rescanning");

  const response = await send({ type: "TS_RESCAN_VIDEO", tabId: activeTabId });
  if (response?.state) render(response.state);
});

elements.rescanButton.addEventListener("animationend", () => {
  elements.rescanButton.classList.remove("is-rescanning");
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
  const response = await send({ type: "TS_RESTART_TOGETHER" });
  setPending(false);

  if (!response?.success) {
    showMessage(elements.roomMessage, response?.message || "Could not restart playback.");
  } else {
    showMessage(elements.roomMessage, "Restarting for Ready participants.", "success");
  }
});

elements.followHostButton.addEventListener("click", async () => {
  const safeUrl = sanitizeFollowUrl(latestState?.followPrompt?.followUrl);
  if (!safeUrl) return;

  try {
    if (Number.isInteger(activeTabId)) {
      await chrome.tabs.update(activeTabId, { url: safeUrl });
    } else {
      await chrome.tabs.create({ url: safeUrl });
    }
  } catch {
    await chrome.tabs.create({ url: safeUrl });
  }

  const response = await send({ type: "TS_DISMISS_FOLLOW_PROMPT" });
  if (response?.state) render(response.state);
});

elements.dismissPromptButton.addEventListener("click", async () => {
  const response = await send({ type: "TS_DISMISS_FOLLOW_PROMPT" });
  if (response?.state) render(response.state);
});

elements.leaveButton.addEventListener("click", async () => {
  const response = await send({ type: "TS_LEAVE_ROOM" });
  if (response?.state) render(response.state);
});

elements.passHostMenuItem.addEventListener("click", () => {
  if (!menuTargetUser) return;
  pendingHostTransfer = {
    participantId: menuTargetUser.participantId,
    name: menuTargetUser.name,
  };
  closeMemberMenu();
  renderPassHostConfirm();
});

elements.passHostCancelButton.addEventListener("click", () => {
  pendingHostTransfer = null;
  renderPassHostConfirm();
});

elements.passHostConfirmButton.addEventListener("click", async () => {
  if (!pendingHostTransfer) return;
  const targetParticipantId = pendingHostTransfer.participantId;
  pendingHostTransfer = null;
  renderPassHostConfirm();

  const response = await send({ type: "TS_TRANSFER_HOST", targetParticipantId });
  if (!response?.success) {
    showMessage(elements.roomMessage, response?.message || "Could not transfer host controls.");
  } else {
    showMessage(elements.roomMessage, "Host controls transferred.", "success");
  }
  await loadState();
});

document.addEventListener("click", (event) => {
  if (elements.memberMenu.classList.contains("hidden")) return;
  if (elements.memberMenu.contains(event.target)) return;
  closeMemberMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMemberMenu();
});

elements.memberList.addEventListener("scroll", closeMemberMenu);

window.addEventListener("unload", () => {
  if (pollingTimer) clearInterval(pollingTimer);
});

init().catch((error) => {
  showMessage(elements.setupMessage, error.message || "Could not initialize the extension.");
});
