"use strict";

globalThis.TOGETHER_SCREEN_CONFIG = Object.freeze({

  // Local development URLs.
  // Replace them with your deployed backend and web app URLs when self-hosting.
  SERVER_URL: "https://togetherscreen.onrender.com",
  WEB_APP_URL: "http://localhost:5173",

  SOCKET_TIMEOUT_MS: 7000,
  SYNC_INTERVAL_MS: 4000,
  DRIFT_THRESHOLD_SECONDS: 0.6,
});