# Tessera

A fully customizable, plugin-based tool to create Super Smash Bros. Ultimate mods.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- UI mockup: [mockups/layout-mockup.html](mockups/layout-mockup.html)

## Development

Requires Node 22.12+.

```bash
npm install
npm run dev        # Electron + Vite with hot reload
npm run build      # production build in apps/desktop/out
npm start          # run the production build
npm run typecheck
```

The Electron binary is downloaded on the first launch.

## Layout

```
apps/desktop/        Electron app
  src/main/          main process: windows, IPC handlers, settings, security policy
  src/preload/       sandboxed preload, exposes window.tessera
  src/renderer/      UI (Atrium-UI, vanilla TypeScript)
    index.html       empty shell, everything is mounted from src/
    src/shell/       titlebar, sidebar, statusbar
    src/pages/<id>/  one folder per page: <id>.html, index.ts, <id>.css
    src/about/       About screen (Atrium-UI credit)
    src/commands/    Ctrl+K commands
    src/i18n/        FR / EN
    src/ui/          UiProvider (Atrium-UI by default)
packages/protocol/   IPC contract (channels, zod schemas, types) shared by all three
docs/                architecture and decisions
mockups/             HTML mockups
```

## Credits

UI by [Atrium-UI](https://github.com/CompagesWorks/Atrium-UI). Icons by [Bootstrap Icons](https://icons.getbootstrap.com/) (MIT).
