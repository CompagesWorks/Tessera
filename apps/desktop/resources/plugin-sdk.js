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

  const scrollbars = document.createElement('style');
  scrollbars.textContent =
    '::-webkit-scrollbar{width:10px;height:10px}' +
    '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}' +
    '::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:10px;background:var(--atrium-border-hover) padding-box}' +
    '::-webkit-scrollbar-thumb:hover{background:var(--atrium-text-muted) padding-box}' +
    '::-webkit-scrollbar-button{display:none}';
  document.head.prepend(scrollbars);

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

  const sent = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let gate = Promise.resolve();

  function pace() {
    gate = gate.then(async () => {
      for (;;) {
        const now = performance.now();
        while (sent.length && now - sent[0] >= 1000) sent.shift();
        if (sent.length < 35) return void sent.push(now);
        await sleep(1000 - (now - sent[0]) + 5);
      }
    });
    return gate;
  }

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ tessera: 1, id, method, params }, '*');
    });
  }

  async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      await pace();
      try {
        return await send(method, params);
      } catch (error) {
        if (error.message !== 'rate limited' || attempt >= 3) throw error;
        await sleep(1000);
      }
    }
  }

  let streams = 0;

  async function streamed(onOutput, run) {
    if (typeof onOutput !== 'function') return run(undefined);
    const stream = `s${(streams += 1)}-${Math.random().toString(36).slice(2, 10)}`;
    const pending = { stdout: '', stderr: '' };
    const deliver = (kind, final) => {
      const lines = pending[kind].split(/\r?\n|\r/);
      pending[kind] = final ? '' : lines.pop();
      for (const line of lines) if (line || !final) onOutput(line, kind);
    };
    const off = window.tessera.on('exec.output', (payload) => {
      if (!payload || payload.stream !== stream || !(payload.kind in pending)) return;
      pending[payload.kind] += payload.text;
      deliver(payload.kind, false);
    });
    try {
      return await run(stream);
    } finally {
      off();
      deliver('stdout', true);
      deliver('stderr', true);
    }
  }

  let menuResolve = null;
  let messages = Object.freeze({});
  let language = 'en';

  function translate(key, params = {}) {
    let text = Object.hasOwn(messages, key) ? messages[key] : key;
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{{${name}}}`, String(value));
    return text;
  }

  const I18N_ATTRIBUTES = [
    ['i18nPlaceholder', 'data-i18n-placeholder', 'placeholder'],
    ['i18nTitle', 'data-i18n-title', 'title'],
    ['i18nLabel', 'data-i18n-label', 'aria-label'],
  ];

  function translatePage() {
    const apply = () => {
      for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n);
      for (const [key, attribute, target] of I18N_ATTRIBUTES) {
        for (const node of document.querySelectorAll(`[${attribute}]`)) node.setAttribute(target, translate(node.dataset[key]));
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
    else apply();
  }
  let dragged = null;
  let dragTimer = 0;
  const wantsDrop = () => dragged !== null && (listeners.get('files.dropped') ?? []).length > 0;
  document.addEventListener('dragover', (event) => {
    if (wantsDrop()) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!wantsDrop()) return;
    event.preventDefault();
    const paths = dragged;
    dragged = null;
    emit('files.dropped', { paths });
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.tessera !== 1) return;
    if (data.event === 'ping') {
      window.parent.postMessage({ tessera: 1, pong: data.payload }, '*');
      return;
    }
    if (data.event === 'menu.select') {
      if (menuResolve) menuResolve(data.payload && data.payload.id);
      menuResolve = null;
      return;
    }
    if (data.event === 'drag') {
      clearTimeout(dragTimer);
      if (data.payload && Array.isArray(data.payload.paths)) dragged = data.payload.paths;
      else dragTimer = setTimeout(() => (dragged = null), 1000);
      return;
    }
    if (typeof data.event === 'string') {
      if (data.event === 'init' || data.event === 'theme') applyTheme(data.payload);
      if (data.event === 'init') settingsValues = Object.freeze({ ...((data.payload && data.payload.settings) || {}) });
      if (data.event === 'init') {
        messages = Object.freeze({ ...((data.payload && data.payload.messages) || {}) });
        language = (data.payload && data.payload.language) || 'en';
        translatePage();
      }
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
    i18n: Object.freeze({
      get language() {
        return language;
      },
      t: translate,
    }),
    ui: Object.freeze({
      toast: (kind, message) => call('ui.toast', { kind, message }),
      contextMenu(spec) {
        if (menuResolve) menuResolve(null);
        return new Promise((resolve, reject) => {
          menuResolve = resolve;
          call('ui.contextMenu', spec).catch((error) => {
            menuResolve = null;
            reject(error);
          });
        });
      },
      form: (spec) => call('ui.form', spec),
      async progress(title, message) {
        await call('ui.progress', { title, message });
        return Object.freeze({
          update: (next, percent) => call('ui.progress', { title, message: next, percent }),
          close: () => call('ui.progress.close'),
        });
      },
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
    export: Object.freeze({
      deploy: () => call('export.deploy'),
    }),
    textures: Object.freeze({
      convert: (from, to, options = {}) =>
        call('textures.convert', { from, to, format: options.format, mipmaps: options.mipmaps, quality: options.quality, gammaFix: options.gammaFix }),
      preview: (path, name) => call('textures.preview', name === undefined ? { path } : { path, name }),
      replace: (path, name, data) => call('textures.replace', { path, ...(name === undefined ? {} : { name }), data: toBase64(data) }),
      add: (path, name, format, data) => call('textures.add', { path, name, format, data: toBase64(data) }),
      export: (path, name, to) => call('textures.export', { path, ...(name === undefined ? {} : { name }), to }),
    }),
    ssbh: Object.freeze({
      read: (path) => call('ssbh.read', { path }),
      write: (path, data) => call('ssbh.write', { path, data }),
      meshes: (path, skeleton) =>
        call('ssbh.meshes', skeleton === undefined ? { path } : { path, skeleton }).then((objects) =>
          objects.map((o) => ({
            ...o,
            positions: new Float32Array(fromBase64(o.positions).buffer),
            normals: new Float32Array(fromBase64(o.normals).buffer),
            uvs: o.uvs === null ? null : new Float32Array(fromBase64(o.uvs).buffer),
            indices: new Uint32Array(fromBase64(o.indices).buffer),
            bones: o.bones === null ? null : new Float32Array(fromBase64(o.bones).buffer),
            weights: o.weights === null ? null : new Float32Array(fromBase64(o.weights).buffer),
          })),
        ),
    }),
    arc: Object.freeze({
      pick: () => call('arc.pick'),
      list: (path = '') => call('arc.list', { path }),
      extract: (path) => call('arc.extract', { path }),
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
      run: (args = [], options = {}) => streamed(options.onOutput, (stream) => call('exec.run', { args, timeout: options.timeout, stream })),
      runSystem: (program, args = [], options = {}) =>
        streamed(options.onOutput, (stream) => call('exec.runSystem', { program, args, timeout: options.timeout, detach: options.detach, projectFile: options.projectFile, stream })),
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
