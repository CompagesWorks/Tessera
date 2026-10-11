import { app, session } from 'electron';

export function applySecurityPolicy(isTrusted: (url: string) => boolean) {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    contents.on('will-navigate', (event, url) => {
      if (!isTrusted(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrusted(url)) event.preventDefault();
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}
