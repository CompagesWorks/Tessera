import { app, session } from 'electron';
import { PLUGIN_SCHEME } from '@tessera/protocol';

export function applySecurityPolicy(isTrusted: (url: string) => boolean, devServer: string | undefined) {
  const devOrigin = devServer ? new URL(devServer).origin : null;
  const devSocket = devOrigin?.replace(/^http/, 'ws') ?? null;

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    contents.on('will-navigate', (event, url) => {
      if (!isTrusted(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrusted(url)) event.preventDefault();
    });
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && !event.url.startsWith(`${PLUGIN_SCHEME}://`)) event.preventDefault();
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    const url = details.url;
    const allowed = (devOrigin && url.startsWith(devOrigin)) || (devSocket && url.startsWith(devSocket));
    callback({ cancel: !allowed });
  });
}
