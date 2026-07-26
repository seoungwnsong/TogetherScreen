const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const joinButton = document.getElementById("joinButton");
const statusText = document.getElementById("statusText");

chrome.storage.local.get(["name", "roomId"], (data) => {
  if (data.name) {
    nameInput.value = data.name;
  }

  if (data.roomId) {
    roomInput.value = data.roomId;
    statusText.textContent = `Connected to room ${data.roomId}.`;
  }
});

joinButton.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const roomId = roomInput.value.trim();

  if (name === "" || roomId === "") {
    statusText.textContent = "Please enter your name and room ID.";
    return;
  }

  chrome.storage.local.set(
    {
      name,
      roomId,
    },
    () => {
      statusText.textContent = `Connected to room ${roomId} as ${name}.`;
      console.log("TogetherScreen popup saved:", { name, roomId });
    }
  );
});