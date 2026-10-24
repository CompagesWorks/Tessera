# Widget lifecycle and size

## Your page can reload at any time

Treat a widget page as disposable. Tessera rebuilds the workspace whenever the layout changes, and every plugin iframe that gets rebuilt reloads from scratch: scripts run again, the DOM is fresh, in-memory variables are gone.

This happens when the user:

- switches to another tab in the same panel, then back (a hidden tab's iframe is unloaded)
- resizes a panel, splits one, drags a widget elsewhere, or closes another widget
- enters or leaves layout editing mode
- switches workspace
- closes and reopens the project
- clicks **Reload** on the "not responding" overlay

Only the widget state (`tessera.widget.setState`) survives a reload.

### The pattern

```js
(async () => {
  await tessera.ready;
  const state = await tessera.widget.getState();

  const model = {
    tab: typeof state.tab === 'string' ? state.tab : 'overview',
    filter: typeof state.filter === 'string' ? state.filter : '',
    scroll: typeof state.scroll === 'number' ? state.scroll : 0,
  };

  render(model);
  list.scrollTop = model.scroll;

  let timer;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => tessera.widget.setState(model), 300);
  }

  filterInput.addEventListener('input', () => {
    model.filter = filterInput.value;
    save();
  });
  list.addEventListener('scroll', () => {
    model.scroll = list.scrollTop;
    save();
  });
})();
```

- Rebuild the whole UI from the state on every start.
- Save anything the user would be annoyed to lose: selected tab, filters, scroll position, a draft being typed.
- Don't save what you can recompute cheaply (file lists, parsed data): read it again on start.
- Debounce saves. A `setState` call does not reload the widget.

### What not to rely on

| Don't | Because |
| --- | --- |
| a global variable as a cache across reloads | it is reset on every reload |
| a long task running in the background | it is killed when the iframe unloads |
| `beforeunload` / `pagehide` to save at the last moment | the iframe can be removed without a reliable chance to run async code; save as you go |
| the widget staying visible | a hidden tab is unloaded, not paused |

Two instances of the same widget are separate pages with separate states, and neither can see the other.

## Size

A widget fills its panel, and panels can be resized freely. Plan for anything from about 80 × 60 px (the smallest panel, minus the tab bar) up to a full window.

- The page gets no resize event from the SDK. Use CSS (flex, grid, `min()`, `clamp()`) first, and `ResizeObserver` when you need to recompute something.
- Make `html` and `body` fill the frame and avoid page-level scrollbars: scroll an inner container instead.
- Use container-friendly layouts: a sidebar that collapses under a given width, text that truncates with `text-overflow: ellipsis`.

```css
html,
body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.root {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

.list {
  overflow: auto;
}
```

```js
const observer = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  document.body.classList.toggle('is-narrow', width < 240);
  drawChart(width, height);
});
observer.observe(document.body);
```

The iframe background is transparent: the panel background of Tessera shows through. Set a background on `body` only if you need one; Atrium's tokens (`var(--atrium-bg-card)`…) keep it consistent with the theme.
