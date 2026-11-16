/* Scramjet 2.x starts when the user opens the proxy screen. */
let scramjetController = null;
let scramjetFrame = null;
let proxyReady = null;
let gamesInitPromise = null;
let gamesInitialized = false;
let gamesPage = 1;
let gamesPageCount = 1;
let gamesSearch = "";
let gamesAreRandom = false;
let searchTimer = null;

async function initProxy() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }

  const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;

  const serviceworker = registration.active || navigator.serviceWorker.controller;
  if (!serviceworker) throw new Error("The Scramjet service worker did not activate.");

  const { default: LibcurlTransport } = await import(
    "https://esm.sh/@mercuryworkshop/libcurl-transport@2.0.5"
  );

  if (!window.$scramjetController?.Controller) {
    throw new Error("Scramjet controller did not load. Check controller.api.js.");
  }

  scramjetController = new window.$scramjetController.Controller({
    serviceworker,
    transport: new LibcurlTransport({ wisp: "wss://wisp.mercurywork.shop/" }),
    config: {
      scramjetPath: "/scram/scramjet.js",
      wasmPath: "/scram/scramjet.wasm",
      injectPath: "/scram/controller.inject.js",
    },
  });

  await scramjetController.wait();
  const iframe = document.getElementById("proxy-frame");
  if (!iframe) throw new Error("The proxy iframe is missing.");
  scramjetFrame = scramjetController.createFrame(iframe);
}

function setProxyStatus(message) {
  const status = document.getElementById("proxy-status");
  if (status) status.textContent = message;
}

async function ensureProxyReady() {
  if (!proxyReady) {
    proxyReady = initProxy().catch((error) => {
      proxyReady = null;
      throw error;
    });
  }
  await proxyReady;
}

function showScreen(screenId) {
  ["home-screen", "games-screen", "apps-screen", "proxy-screen"].forEach((id) => {
    const screen = document.getElementById(id);
    if (screen) screen.classList.toggle("screen-hidden", id !== screenId);
  });
}

function resolveBrowserAddress(value) {
  const input = value.trim();
  if (/^https?:\/\//i.test(input)) return input;

  const looksLikeHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(input) || input.includes(".");
  if (!looksLikeHost || /\s/.test(input)) {
    return "https://www.google.com/search?q=" + encodeURIComponent(input);
  }
  return "https://" + input;
}

async function navigateProxy(rawAddress) {
  if (!rawAddress.trim()) return;

  const address = resolveBrowserAddress(rawAddress);
  const input = document.getElementById("url-input");
  const pageArea = document.querySelector(".proxy-page-area");

  try {
    setProxyStatus("Opening page…");
    await ensureProxyReady();
    if (input) input.value = address;
    pageArea?.classList.add("has-page");
    scramjetFrame.go(address);
    setProxyStatus("");
  } catch (error) {
    console.error("Could not load proxied site:", error);
    setProxyStatus("Could not load the page: " + error.message);
  }
}

function runProxyNavigation(action) {
  if (!scramjetFrame) {
    setProxyStatus("Enter a web address first.");
    return;
  }
  try {
    scramjetFrame[action]();
  } catch (error) {
    setProxyStatus("Browser action failed: " + error.message);
  }
}
function setGamesStatus(message) {
  const status = document.getElementById("games-status");
  if (status) status.textContent = message;
}

function makeGameCard(game, imageUrl) {
  const card = document.createElement("article");
  card.className = "game-card";

  const button = document.createElement("button");
  button.className = "game-launch";
  button.type = "button";
  button.dataset.gameId = game.id;
  button.setAttribute("aria-label", "Play " + game.name);

  const art = document.createElement("div");
  art.className = "game-art";
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    art.appendChild(image);
  } else {
    art.classList.add("game-art-empty");
    art.textContent = "TRAIN ARCADE";
  }

  const copy = document.createElement("div");
  copy.className = "game-copy";
  const category = document.createElement("span");
  category.className = "game-category";
  category.textContent = game.category || "Arcade";
  const name = document.createElement("strong");
  name.className = "game-name";
  name.textContent = game.name;

  const play = document.createElement("span");
  play.className = "game-play";
  play.setAttribute("aria-hidden", "true");
  play.textContent = "▶";

  copy.append(category, name, play);
  button.append(art, copy);
  card.appendChild(button);
  return card;
}

async function renderGames(games, total) {
  const grid = document.getElementById("games");
  const count = document.getElementById("games-count");
  if (!grid) return;

  grid.replaceChildren();
  if (count) count.textContent = total.toLocaleString() + (total === 1 ? " game" : " games");

  if (!games.length) {
    setGamesStatus("No games found. Try a different search.");
    return;
  }

  setGamesStatus("Loading game art…");
  const imageUrls = await Promise.all(
    games.map((game) =>
      window.Lumin.getImageUrl(game.image_token).catch(() => "")
    )
  );

  games.forEach((game, index) => {
    grid.appendChild(makeGameCard(game, imageUrls[index]));
  });

  setGamesStatus(gamesAreRandom ? "A fresh set of games for you." : "");
}

function updateGamesPager() {
  const pager = document.querySelector(".games-pagination");
  const previous = document.getElementById("games-prev");
  const next = document.getElementById("games-next");
  const label = document.getElementById("games-page");
  if (pager) pager.hidden = gamesAreRandom;
  if (previous) previous.disabled = gamesPage <= 1;
  if (next) next.disabled = gamesPage >= gamesPageCount;
  if (label) label.textContent = "Page " + gamesPage + " of " + gamesPageCount;
}

async function loadGames(page = 1) {
  gamesAreRandom = false;
  gamesPage = page;
  setGamesStatus("Finding games…");

  const result = await window.Lumin.getGames({
    page: gamesPage,
    limit: 20,
    q: gamesSearch,
  });

  gamesPageCount = Math.max(1, result.pages || 1);
  updateGamesPager();
  await renderGames(result.games || [], result.total || 0);
}

async function loadRandomGames() {
  gamesAreRandom = true;
  setGamesStatus("Picking a few favorites…");
  updateGamesPager();

  const result = await window.Lumin.getRandomGames(20);
  await renderGames(result.games || [], (result.games || []).length);
}

async function initGames() {
  if (gamesInitialized) return;
  if (gamesInitPromise) return gamesInitPromise;

  gamesInitPromise = (async () => {
    if (typeof window.Lumin === "undefined") {
      throw new Error("The Lumin library did not load. Check your internet connection and refresh.");
    }
    setGamesStatus("Connecting to the game library…");
    await window.Lumin.init({ headless: true });
    gamesInitialized = true;
    await loadGames(1);
  })();

  try {
    await gamesInitPromise;
  } catch (error) {
    gamesInitPromise = null;
    setGamesStatus("Could not load the game library: " + error.message);
    console.error("Could not initialize Lumin:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("proxy-button")?.addEventListener("click", async () => {
    showScreen("proxy-screen");
    const button = document.getElementById("proxy-button");
    if (button) button.disabled = true;
    setProxyStatus("Starting Scramjet…");

    try {
      await ensureProxyReady();
      setProxyStatus("Ready. Enter a website above.");
    } catch (error) {
      console.error("Failed to initialize Scramjet:", error);
      setProxyStatus("Could not start Scramjet: " + error.message);
    } finally {
      if (button) button.disabled = false;
    }
  });

  document.getElementById("games-button")?.addEventListener("click", () => {
    showScreen("games-screen");
    void initGames();
  });

  document.getElementById("apps-button")?.addEventListener("click", () => {
    showScreen("apps-screen");
  });

  document.querySelectorAll(".back-button").forEach((button) => {
    button.addEventListener("click", () => showScreen("home-screen"));
  });

  document.getElementById("game-search")?.addEventListener("input", (event) => {
    gamesSearch = event.target.value.trim();
    gamesAreRandom = false;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (gamesInitialized) void loadGames(1); }, 250);
  });

  document.getElementById("random-game")?.addEventListener("click", () => {
    if (gamesInitialized) void loadRandomGames();
  });

  document.getElementById("games-prev")?.addEventListener("click", () => {
    if (gamesPage > 1) void loadGames(gamesPage - 1);
  });

  document.getElementById("games-next")?.addEventListener("click", () => {
    if (gamesPage < gamesPageCount) void loadGames(gamesPage + 1);
  });

  document.getElementById("games")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-game-id]");
    if (!button) return;
    const gameName = button.querySelector(".game-name")?.textContent || "game";
    setGamesStatus("Launching " + gameName + "…");
    try {
      await window.Lumin.loadGame(button.dataset.gameId);
      setGamesStatus("");
    } catch (error) {
      console.error("Could not launch game:", error);
      setGamesStatus("Could not launch " + gameName + ": " + error.message);
    }
  });

  document.getElementById("proxy-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("url-input");
    if (input) void navigateProxy(input.value);
  });

  document.getElementById("proxy-nav-back")?.addEventListener("click", () => runProxyNavigation("back"));
  document.getElementById("proxy-nav-forward")?.addEventListener("click", () => runProxyNavigation("forward"));
  document.getElementById("proxy-nav-reload")?.addEventListener("click", () => runProxyNavigation("reload"));

  document.querySelectorAll(".proxy-bookmark[data-open-url]").forEach((bookmark) => {
    bookmark.addEventListener("click", () => {
      const input = document.getElementById("url-input");
      if (input) input.value = bookmark.dataset.openUrl;
      void navigateProxy(bookmark.dataset.openUrl);
    });
  });
});



