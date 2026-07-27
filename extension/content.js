"use strict";

(() => {
  const OVERLAY_ID = "togetherscreen-extension-overlay";
  let activeVideo = null;
  let applyingRemoteUpdate = false;
  let attachedListeners = null;
  let scanTimer = null;

  function isVisibleVideo(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);

    return (
      rect.width >= 160 &&
      rect.height >= 90 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0
    );
  }

  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;

    const visible = videos.filter(isVisibleVideo);
    const candidates = visible.length > 0 ? visible : videos;

    return candidates.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.width * bRect.height - aRect.width * aRect.height;
    })[0];
  }

  function videoSnapshot() {
    const video = activeVideo;

    return {
      found: Boolean(video),
      title:
        document.querySelector("h1")?.textContent?.trim()?.slice(0, 100) ||
        document.title?.slice(0, 100) ||
        "Video",
      currentTime: video ? Number(video.currentTime) || 0 : 0,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      paused: video ? video.paused : true,
      url: location.href,
    };
  }

  function reportVideoState() {
    chrome.runtime.sendMessage({
      type: "TS_VIDEO_STATE",
      video: videoSnapshot(),
    }).catch(() => {});
  }

  function removeListeners() {
    if (!activeVideo || !attachedListeners) return;

    activeVideo.removeEventListener("play", attachedListeners.play);
    activeVideo.removeEventListener("pause", attachedListeners.pause);
    activeVideo.removeEventListener("seeked", attachedListeners.seeked);
    activeVideo.removeEventListener("loadedmetadata", attachedListeners.loadedmetadata);
    activeVideo.removeEventListener("durationchange", attachedListeners.durationchange);
    attachedListeners = null;
  }

  function sendLocalEvent(type) {
    if (!activeVideo || applyingRemoteUpdate) return;

    chrome.runtime.sendMessage({
      type: "TS_LOCAL_VIDEO_EVENT",
      event: {
        type,
        time: Number(activeVideo.currentTime) || 0,
        isPlaying: !activeVideo.paused,
      },
    }).catch(() => {});
  }

  function attachVideo(video) {
    if (video === activeVideo) return;

    removeListeners();
    activeVideo = video;

    if (!video) {
      reportVideoState();
      return;
    }

    attachedListeners = {
      play: () => {
        sendLocalEvent("play");
        reportVideoState();
      },
      pause: () => {
        sendLocalEvent("pause");
        reportVideoState();
      },
      seeked: () => {
        sendLocalEvent("seek");
        reportVideoState();
      },
      loadedmetadata: reportVideoState,
      durationchange: reportVideoState,
    };

    video.addEventListener("play", attachedListeners.play);
    video.addEventListener("pause", attachedListeners.pause);
    video.addEventListener("seeked", attachedListeners.seeked);
    video.addEventListener("loadedmetadata", attachedListeners.loadedmetadata);
    video.addEventListener("durationchange", attachedListeners.durationchange);

    reportVideoState();
  }

  function scanForVideo() {
    const nextVideo = findBestVideo();
    attachVideo(nextVideo);
    return videoSnapshot();
  }

  function showOverlay(text, { persistent = false } = {}) {
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.textContent = text;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "grid",
      placeItems: "center",
      background: "rgba(0, 0, 0, 0.48)",
      color: "#ffffff",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "clamp(3rem, 12vw, 8rem)",
      fontWeight: "900",
      letterSpacing: "-0.05em",
      pointerEvents: persistent ? "auto" : "none",
      backdropFilter: "blur(3px)",
    });

    if (persistent) {
      overlay.style.fontSize = "clamp(1rem, 4vw, 2rem)";
      overlay.style.padding = "24px";
      overlay.style.textAlign = "center";
      overlay.style.cursor = "pointer";
      overlay.title = "Click to enable playback";
      overlay.addEventListener("click", async () => {
        try {
          await activeVideo?.play();
          overlay.remove();
        } catch {
          // Keep the overlay visible when the browser still blocks playback.
        }
      });
    }

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  async function applyVideoEvent(event) {
    const video = activeVideo || findBestVideo();
    if (!video) return { success: false, message: "No video found." };

    attachVideo(video);
    applyingRemoteUpdate = true;

    try {
      if (Math.abs(video.currentTime - Number(event.time || 0)) > 0.2) {
        video.currentTime = Math.max(0, Number(event.time) || 0);
      }

      if (event.type === "play" || event.isPlaying === true) {
        try {
          await video.play();
        } catch {
          showOverlay("Click to enable synchronized playback", { persistent: true });
        }
      } else if (event.type === "pause" || event.isPlaying === false) {
        video.pause();
      }
    } finally {
      setTimeout(() => {
        applyingRemoteUpdate = false;
        reportVideoState();
      }, 400);
    }

    return { success: true, video: videoSnapshot() };
  }

  async function applySyncState(event) {
    const video = activeVideo || findBestVideo();
    if (!video) return { success: false };

    attachVideo(video);
    const targetTime = Math.max(0, Number(event.time) || 0);
    const difference = Math.abs(video.currentTime - targetTime);
    const playingStateDiffers = Boolean(event.isPlaying) === video.paused;

    if (difference > 0.6 || playingStateDiffers) {
      return applyVideoEvent({
        type: event.isPlaying ? "play" : "pause",
        time: targetTime,
        isPlaying: Boolean(event.isPlaying),
      });
    }

    return { success: true, video: videoSnapshot() };
  }

  async function startTogether(event) {
    const video = activeVideo || findBestVideo();
    if (!video) return { success: false, message: "No video found." };

    attachVideo(video);
    const targetTime = Math.max(0, Number(event.videoTime) || 0);
    const delay = Math.max(0, Number(event.startAt) - Date.now());
    const secondsRemaining = Math.max(1, Math.ceil(delay / 1000));
    let current = secondsRemaining;
    const overlay = showOverlay(String(current));

    const countdown = setInterval(() => {
      current -= 1;
      if (current > 0) overlay.textContent = String(current);
    }, 1000);

    setTimeout(async () => {
      clearInterval(countdown);
      overlay.textContent = "Play";
      applyingRemoteUpdate = true;
      video.currentTime = targetTime;

      try {
        await video.play();
        setTimeout(() => overlay.remove(), 450);
      } catch {
        overlay.remove();
        showOverlay("Click to enable synchronized playback", { persistent: true });
      } finally {
        setTimeout(() => {
          applyingRemoteUpdate = false;
          reportVideoState();
        }, 500);
      }
    }, delay);

    return { success: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case "TS_GET_VIDEO_STATE":
          scanForVideo();
          return { success: true, video: videoSnapshot() };

        case "TS_RESCAN_VIDEO":
          return { success: true, video: scanForVideo() };

        case "TS_APPLY_PLAYBACK_SNAPSHOT":
          return applyVideoEvent({
            type: message.playback?.isPlaying ? "play" : "pause",
            time: message.playback?.currentTime || 0,
            isPlaying: Boolean(message.playback?.isPlaying),
          });

        case "TS_APPLY_VIDEO_EVENT":
          return applyVideoEvent(message.event || {});

        case "TS_APPLY_SYNC_STATE":
          return applySyncState(message.event || {});

        case "TS_START_TOGETHER":
          return startTogether(message.event || {});

        default:
          return { success: false, message: "Unknown video request." };
      }
    })()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : "Video control failed.",
        });
      });

    return true;
  });

  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForVideo, 300);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "style", "class"],
  });

  scanForVideo();
  setInterval(scanForVideo, 3000);
})();
