(() => {
  'use strict';
  if (window.tessera) return;

  const pending = new Map();
  const listeners = new Map();
  let seq = 0;

  for (const href of ['__tessera/atrium.css', '__tessera/bootstrap-icons.css']) {
    if (document.querySelector(`link[href$="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/${href}`;
    document.head.prepend(link);
  }

  function emit(event, payload) {
    for (const listener of listeners.get(event) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(error);
      }
    }
  }

  let tokenNames = [];
  let watchers = 0;
  let settingsValues = {};

  const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
  const MAX_LOGS_PER_SECOND = 30;
  let logsThisSecond = 0;
  setInterval(() => {
    logsThisSecond = 0;
  }, 1000);

  function describe(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function sendLog(level, args) {
    if (++logsThisSecond > MAX_LOGS_PER_SECOND) return;
    try {
      window.parent.postMessage({ tessera: 1, log: { level, text: args.map(describe).join(' ').slice(0, 2000) } }, '*');
    } catch {}
  }

  for (const level of LOG_LEVELS) {
    const original = console[level];
    console[level] = (...args) => {
      sendLog(level, args);
      return original.apply(console, args);
    };
  }
  window.addEventListener('error', (event) => sendLog('error', [event.message + (event.filename ? ` (${event.filename}:${event.lineno})` : '')]));
  window.addEventListener('unhandledrejection', (event) => sendLog('error', ['Unhandled rejection: ', event.reason]));

  function applyTheme(payload) {
    const theme = payload && payload.theme;
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.atriumTheme = theme;
    const style = document.documentElement.style;
    for (const name of tokenNames) style.removeProperty(name);
    tokenNames = [];
    const tokens = payload && payload.tokens;
    if (!tokens || typeof tokens !== 'object') return;
    for (const [name, value] of Object.entries(tokens)) {
      if (!name.startsWith('--atrium-') || typeof value !== 'string') continue;
      style.setProperty(name, value);
      tokenNames.push(name);
    }
  }

  function fileApi(scope) {
    return {
      list: (path = '') => call('fs.list', { scope, path }),
      readText: (path) => call('fs.readText', { scope, path }),
      writeText: (path, content) => call('fs.writeText', { scope, path, content }),
      mkdir: (path) => call('fs.mkdir', { scope, path }),
      remove: (path) => call('fs.remove', { scope, path }),
      rename: (from, to) => call('fs.rename', { scope, from, to }),
      readBytes: (path) => call('fs.readBytes', { scope, path }).then(fromBase64),
      writeBytes: (path, data) => call('fs.writeBytes', { scope, path, data: toBase64(data) }),
    };
  }

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function toBase64(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ tessera: 1, id, method, params }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.tessera !== 1) return;
    if (data.event === 'ping') {
      window.parent.postMessage({ tessera: 1, pong: data.payload }, '*');
      return;
    }
    if (typeof data.event === 'string') {
      if (data.event === 'init' || data.event === 'theme') applyTheme(data.payload);
      if (data.event === 'init') settingsValues = Object.freeze({ ...((data.payload && data.payload.settings) || {}) });
      if (data.event === 'settings.changed') settingsValues = Object.freeze({ ...(data.payload || {}) });
      emit(data.event, data.payload);
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  const ready = new Promise((resolve) => {
    const list = listeners.get('init') ?? [];
    list.push(resolve);
    listeners.set('init', list);
  });

  window.tessera = Object.freeze({
    ready,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
    },
    ui: Object.freeze({
      toast: (kind, message) => call('ui.toast', { kind, message }),
    }),
    widget: Object.freeze({
      getState: () => call('widget.getState'),
      setState: (state) => call('widget.setState', { state }),
    }),
    project: Object.freeze({
      info: () => call('project.info'),
    }),
    settings: Object.freeze({
      get: (key) => (key === undefined ? settingsValues : settingsValues[key]),
      set: (key, value) => call('settings.set', { key, value }),
      reset: (key) => call('settings.reset', { key }),
      onChange: (listener) => window.tessera.on('settings.changed', listener),
    }),
    files: Object.freeze({
      ...fileApi('project'),
      watch(listener) {
        const off = window.tessera.on('files.changed', listener);
        let active = true;
        watchers += 1;
        const started = watchers === 1 ? call('files.watch', { watching: true }) : Promise.resolve();
        started.catch(() => {});
        return () => {
          if (!active) return;
          active = false;
          off();
          watchers -= 1;
          if (watchers === 0) call('files.watch', { watching: false }).catch(() => {});
        };
      },
      private: Object.freeze(fileApi('private')),
    }),
    external: Object.freeze({
      pick: () => call('external.pick'),
      info: () => call('external.info'),
      ...fileApi('external'),
    }),
    net: Object.freeze({
      fetch: (url, options = {}) =>
        call('net.fetch', {
          url,
          method: options.method,
          headers: options.headers,
          body: options.body,
          responseType: options.responseType,
        }),
    }),
    secrets: Object.freeze({
      get: (key) => call('secrets.get', { key }),
      set: (key, value) => call('secrets.set', { key, value }),
      delete: (key) => call('secrets.delete', { key }),
      keys: () => call('secrets.keys'),
    }),
    exec: Object.freeze({
      run: (args = [], options = {}) => call('exec.run', { args, timeout: options.timeout }),
      runSystem: (program, args = [], options = {}) => call('exec.runSystem', { program, args, timeout: options.timeout }),
      pickSystem: (program) => call('exec.pickSystem', { program }),
      systemInfo: () => call('exec.systemInfo'),
    }),
    discord: Object.freeze({
      setActivity: (activity) => call('discord.setActivity', { activity: activity ?? null }),
    }),
    clipboard: Object.freeze({
      writeText: (text) => call('clipboard.writeText', { text }),
    }),
    notify: Object.freeze({
      show: (title, body = '') => call('notify.show', { title, body }),
    }),
    shell: Object.freeze({
      openUrl: (url) => call('shell.openUrl', { url }),
      reveal: (path = '', scope = 'project') => call('shell.reveal', { scope, path }),
    }),
    projects: Object.freeze({
      list: () => call('projects.list'),
    }),
  });

  window.parent.postMessage({ tessera: 1, hello: true }, '*');
})();
