import { contextBridge, ipcRenderer } from "electron";
import {
  APP_SCHEME,
  CHANNEL,
  type AppInfo,
  type DeepLink,
  type DesktopApi,
} from "./shared.js";

/**
 * The only bridge between the trusted main process and the web app.
 *
 * Deliberately tiny: four calls and one subscription. The renderer gets no
 * `ipcRenderer`, no `require`, and no filesystem — everything here is an
 * explicit, typed operation the app actually needs.
 */

const api: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(CHANNEL.appInfo) as Promise<AppInfo>,

  // Links to anywhere but our own scheme open in the user's real browser.
  // Nothing in the app shell should ever navigate the window away from the
  // app, so this is the only way out.
  openExternal: (url: string) => {
    if (!/^https?:\/\//i.test(url)) return Promise.resolve();
    return ipcRenderer.invoke(CHANNEL.openExternal, url) as Promise<void>;
  },

  setLaunchOnLogin: (enabled: boolean) =>
    ipcRenderer.invoke(CHANNEL.setLaunchOnLogin, enabled) as Promise<boolean>,

  onDeepLink: (handler: (link: DeepLink) => void) => {
    const listener = (_event: unknown, link: DeepLink) => handler(link);
    ipcRenderer.on(CHANNEL.deepLink, listener);
    return () => {
      ipcRenderer.removeListener(CHANNEL.deepLink, listener);
    };
  },
};

contextBridge.exposeInMainWorld("nexaDesktop", api);

// Tell the main process the renderer is alive so any deep link that arrived
// during startup can be delivered. Without this, `nexameet://join/CODE`
// clicked from cold start would be dropped.
ipcRenderer.send("nexa:renderer-ready");

export { APP_SCHEME };