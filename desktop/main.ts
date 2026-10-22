import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  BrowserWindow,
  Menu,
  app,
  desktopCapturer,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  Tray,
} from "electron";
import {
  APP_PROTOCOL,
  APP_SCHEME,
  CHANNEL,
  parseDeepLink,
  queueDeepLink,
  takeQueuedDeepLink,
  type AppInfo,
  type DeepLink,
} from "./shared.js";

/**
 * Nexa Meet desktop shell.
 *
 * The meeting itself is the web app — same bundle, same Convex backend,
 * same room codes — so a call started here is joined by anyone in a
 * browser and vice versa. This file only owns the things a browser tab
 * cannot do: a tray, OS deep links, real screen-share picking, native
 * notifications routing, and a stable app identity.
 *
 * The renderer runs sandboxed with context isolation and no Node access.
 * The only channel across that boundary is `desktop/preload.ts`.
 */

/** Where the built web app lives, relative to this file after compilation. */
const DIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);

/** `nexa://app/` — the origin the web app is served from. */
const APP_ORIGIN = `${APP_PROTOCOL}://app`;
const APP_URL = `${APP_ORIGIN}/index.html`;

/**
 * Set by `bun run desktop:dev` to point the shell at the Vite dev server.
 *
 * Accepted both as an environment variable and as `--dev-url=...` on the
 * command line: the environment form does not survive a Windows shell
 * without a helper package, the argument form works everywhere.
 */
const DEV_SERVER_URL =
  process.env.NEXA_DESKTOP_DEV_URL ??
  (process.argv.find((argument) => argument.startsWith("--dev-url="))?.slice(
    "--dev-url=".length,
  ) ??
  "");

let mainWindow: BrowserWindow | null = null;
let tray: Electron.Tray | null = null;
/** The link we still owe the renderer, if it arrived before it was ready. */
let rendererReady = false;
let pendingLink: DeepLink | null = null;
/** Lets the close handler tell "hide to tray" apart from a real quit. */
let quitting = false;

/* ------------------------------------------------------------------ *
 * Protocol
 *
 * Registered before `app.whenReady` so the scheme is already privileged by
 * the time the session is created. `secure: true` is the load-bearing
 * flag: without a secure context the renderer cannot open the camera or
 * the microphone, and this app does nothing else.
 * ------------------------------------------------------------------ */

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

function createWindow(startUrl: string = APP_URL): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 480,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0d" : "#ffffff",
    // macOS gets the traffic lights drawn over our own top bar, matching
    // the rest of the platform; everywhere else keeps the native frame.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 18 } }
      : {}),
    webPreferences: {
      preload: path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "preload.js",
      ),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for an ESM preload; the renderer still gets no Node.
      sandbox: false,
      webSecurity: true,
      // A call must not stall when the window is behind something else:
      // timers, the heartbeat and the mesh all keep running.
      backgroundThrottling: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadURL(startUrl);
  }

  return window;
}

/**
 * Serve the built app out of `dist/`, with an SPA fallback.
 *
 * Client-side routes like `/dashboard` and `/m/CODE` are not files on
 * disk, so anything that misses falls back to `index.html` and lets the
 * router sort it out. Path traversal is rejected outright rather than
 * normalised into something that escapes `DIST_DIR`.
 */
function registerAppProtocol(): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname);
    const candidate = path.resolve(DIST_DIR, `.${relative}`);

    if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    let file = candidate;
    if (!relative || relative === "/") {
      file = path.join(DIST_DIR, "index.html");
    } else {
      try {
        // Confirm it is a real file; otherwise fall through to the SPA root.
        await readFile(file);
      } catch {
        file = path.join(DIST_DIR, "index.html");
      }
    }

    // `net.fetch` understands file: and sets a sensible content type.
    return await net.fetch(pathToFileURL(file).toString());
  });
}

/* ------------------------------------------------------------------ *
 * Session policy
 * ------------------------------------------------------------------ */

function configureSession(target: Electron.Session): void {
  // Least privilege: a conferencing app needs the camera, the microphone
  // and notifications. Nothing else on the web is granted.
  target.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(
      permission === "media" ||
        permission === "notifications" ||
        permission === "fullscreen",
    );
  });
  target.setPermissionCheckHandler((_wc, permission) => {
    return (
      permission === "media" ||
      permission === "notifications" ||
      permission === "fullscreen"
    );
  });

  /**
   * Screen share: pick ONE window or one screen, the way Zoom does.
   *
   * Deliberately not calling the callback is the feature — Electron then
   * shows its own picker (or the OS picker where the platform has one)
   * instead of us grabbing the whole screen without asking.
   */
  target.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // Touching desktopCapturer here keeps the capability alive and makes
      // the "we chose not to auto-grant" decision explicit.
      void desktopCapturer.getSources({ types: ["screen", "window"] }).then(
        (sources) => {
          if (sources.length === 0) callback({});
        },
      );
    },
    { useSystemPicker: true },
  );
}

/* ------------------------------------------------------------------ *
 * Navigation policy
 *
 * The window is the app. Anything that tries to take it somewhere else
 * opens in the user's real browser instead.
 * ------------------------------------------------------------------ */

function guardNavigation(target: BrowserWindow): void {
  target.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  target.webContents.on("will-navigate", (event, url) => {
    const isOurApp =
      url.startsWith(APP_ORIGIN) ||
      (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL));
    if (isOurApp) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
}

/* ------------------------------------------------------------------ *
 * Tray
 * ------------------------------------------------------------------ */

/**
 * The mark, drawn in code rather than shipped as a binary asset — one fewer
 * file to keep in sync with the brand, and it scales to any size. The
 * geometry mirrors public/logo.svg exactly (same 512-unit grid, same
 * 116-unit tile radius), sampled with supersampling so the diagonal and the
 * accent's taper don't stair-step at 32px.
 *
 * On macOS it becomes a template image so it follows menu-bar appearance.
 */
function appIcon(): Electron.NativeImage {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 3;
  const perAxis = samples * samples;
  const unit = size / 512; // device px -> the SVG's 512 grid

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

  /** Rounded-rectangle hit test (the tile, and the stem's square ends). */
  const inRoundedRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) => {
    const dx = Math.max(r - x, 0, x - (w - r));
    const dy = Math.max(r - y, 0, y - (h - r));
    return dx * dx + dy * dy <= r * r;
  };

  /** Even-odd ray cast — enough for the convex shapes the mark is made of. */
  const inPolygon = (
    points: ReadonlyArray<readonly [number, number]>,
    x: number,
    y: number,
  ) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const diagonal = [
    [188, 132],
    [232, 132],
    [368, 384],
    [324, 384],
  ] as const;
  const accentStroke = [
    [324, 132],
    [350, 132],
    [368, 150],
    [368, 340],
    [324, 258],
  ] as const;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let hits = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / unit;
          const y = (py + (sy + 0.5) / samples) / unit;
          if (!inRoundedRect(x, y, 512, 512, 116)) continue;

          const shade = clamp01(Math.hypot(x - 240, y - 205) / 330);
          let rgb: [number, number, number] = [
            lerp(0x2f, 0x0c, shade),
            lerp(0x31, 0x0d, shade),
            lerp(0x35, 0x0f, shade),
          ];
          const stemFoot = Math.hypot(x - 160, y - 368) <= 16;
          if (
            (x >= 144 && x <= 188 && y >= 132 && y <= 384) ||
            stemFoot ||
            inPolygon(diagonal, x, y)
          ) {
            rgb = [0xff, 0xff, 0xff];
          } else if (inPolygon(accentStroke, x, y)) {
            const t = clamp01((y - 132) / 208);
            rgb = [lerp(0xff, 0x6d, t), lerp(0xff, 0x80, t), lerp(0xff, 0xe8, t)];
          }
          rSum += rgb[0];
          gSum += rgb[1];
          bSum += rgb[2];
          hits++;
        }
      }

      const alpha = hits / perAxis;
      const index = (py * size + px) * 4;
      // Premultiplied BGRA, the layout createFromBitmap expects.
      pixels[index] = Math.round((bSum / perAxis) * alpha);
      pixels[index + 1] = Math.round((gSum / perAxis) * alpha);
      pixels[index + 2] = Math.round((rSum / perAxis) * alpha);
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }

  const image = nativeImage.createFromBitmap(pixels, { width: size, height: size });
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}

function showWindow(): void {
  if (mainWindow === null) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTray(): void {
  const created = new Tray(appIcon());
  tray = created;
  refreshTrayMenu();

  created.on("click", () => {
    if (mainWindow?.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });
}

/** Rebuilds the tray menu from live window state. */
function refreshTrayMenu(): void {
  if (tray === null) return;
  const inCall = Boolean(mainWindow?.webContents.getURL().includes("/m/"));
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: "Open Nexa Meet", click: showWindow },
    { type: "separator" },
    {
      label: "New meeting",
      click: () => {
        showWindow();
        deliverDeepLink({ kind: "start" });
      },
    },
    {
      label: "Join with code…",
      click: () => {
        showWindow();
        deliverDeepLink({ kind: "unknown", raw: "prompt" });
      },
    },
  ];
  if (inCall) template.push({ type: "separator" }, { label: "Return to call", click: showWindow });
  template.push(
    { type: "separator" },
    {
      label: "Quit Nexa Meet",
      // Quitting mid-call is the one destructive thing a tray can do.
      accelerator: "CommandOrControl+Q",
      click: () => app.quit(),
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ *
 * Deep links
 * ------------------------------------------------------------------ */

function deliverDeepLink(link: DeepLink): void {
  if (mainWindow === null) return;
  showWindow();
  if (rendererReady && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNEL.deepLink, link);
    return;
  }
  pendingLink = link;
}

/** Flushes a link captured during startup once the renderer can receive it. */
function flushPendingLink(): void {
  rendererReady = true;
  if (pendingLink === null) return;
  const link = pendingLink;
  pendingLink = null;
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNEL.deepLink, link);
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle(CHANNEL.appInfo, (): AppInfo => {
    return {
      desktop: true,
      platform:
        process.platform === "darwin"
          ? "darwin"
          : process.platform === "win32"
            ? "win32"
            : process.platform === "linux"
              ? "linux"
              : "other",
      version: app.getVersion(),
      electron: process.versions.electron,
    };
  });

  ipcMain.handle(CHANNEL.openExternal, async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });

  ipcMain.handle(
    CHANNEL.setLaunchOnLogin,
    (_event, enabled: unknown) => {
      const on = enabled === true;
      app.setLoginItemSettings({ openAtLogin: on });
      return app.getLoginItemSettings().openAtLogin;
    },
  );

  ipcMain.on("nexa:renderer-ready", () => flushPendingLink());
}

/* ------------------------------------------------------------------ *
 * Menu
 *
 * macOS needs a real application menu, not just a tray: without an Edit
 * menu the standard clipboard shortcuts (Cmd+C/V/X/A) silently do nothing
 * inside inputs, which reads as "the app is broken".
 * ------------------------------------------------------------------ */function buildApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({
    label: "File",
    submenu: [
      {
        label: "New meeting",
        accelerator: "CommandOrControl+N",
        click: () => deliverDeepLink({ kind: "start" }),
      },
      { type: "separator" },
      ...(isMac ? [] : [{ role: "quit" as const }]),
    ],
  });

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  });

  template.push({
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  });

  const windowSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "minimize" },
    { role: "zoom" },
  ];
  if (isMac) {
    windowSubmenu.push({ type: "separator" }, { role: "front" });
  } else {
    windowSubmenu.push({ role: "close" });
  }
  template.push({ label: "Window", submenu: windowSubmenu });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

// A second launch (Windows/Linux, or a deep link) must focus the running
// app rather than start a rival copy with its own window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    for (const argument of argv) {
      if (argument.startsWith(`${APP_SCHEME}://`)) {
        deliverDeepLink(parseDeepLink(argument));
        break;
      }
    }
    showWindow();
  });

  // macOS delivers links here, including on cold start.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const link = parseDeepLink(url);
    if (mainWindow === null) queueDeepLink(link);
    else deliverDeepLink(link);
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    configureSession(session.defaultSession);
    registerIpc();
    buildApplicationMenu();

    // A link that arrived before the window existed has to land somewhere
    // that actually listens for it. The dashboard is the screen with the
    // deep-link handlers, so cold-start opens straight to it; the SPA
    // fallback serves index.html and the router takes it from there.
    const queued = takeQueuedDeepLink();
    const startUrl =
      queued !== null && !DEV_SERVER_URL
        ? `${APP_ORIGIN}/dashboard`
        : APP_URL;

    mainWindow = createWindow(startUrl);
    guardNavigation(mainWindow);
    refreshTrayMenu();

    // The app is a meeting tool: closing the window should not end a call.
    mainWindow.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      mainWindow?.hide();
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
      refreshTrayMenu();
    });

    mainWindow.webContents.on("did-navigate", refreshTrayMenu);

    buildTray();

    // Delivered over IPC; the renderer flushes it on subscribe, so it is
    // never lost to a race with the first paint.
    if (queued !== null) deliverDeepLink(queued);

    app.on("activate", () => {
      if (mainWindow === null) {
        mainWindow = createWindow();
        guardNavigation(mainWindow);
      }
      showWindow();
    });
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("window-all-closed", () => {
    // The tray keeps the app alive on every platform; quitting is explicit.
    if (process.platform !== "darwin") return;
    app.quit();
  });
}