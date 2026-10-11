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

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.atriumTheme = theme;
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
    if (typeof data.event === 'string') {
      if (data.event === 'init' || data.event === 'theme') applyTheme(data.payload && data.payload.theme);
      emit(data.event, data.payload);
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  window.addEventListener('keydown', (event) => {
    const shortcut = event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(event.key);
    if (!shortcut) return;
    window.parent.postMessage(
      {
        tessera: 1,
        key: {
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        },
      },
      '*',
    );
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
    files: Object.freeze({
      list: (path = '') => call('files.list', { path }),
      readText: (path) => call('files.readText', { path }),
    }),
  });

  window.parent.postMessage({ tessera: 1, hello: true }, '*');
})();
