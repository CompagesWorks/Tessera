const TEXT = {
  fr: {
    deploying: 'Export et copie…',
    deployed: 'Déployé dans mods/{name}',
    needMods: 'Choisis d’abord le dossier mods.',
  },
  en: {
    deploying: 'Exporting and copying…',
    deployed: 'Deployed to mods/{name}',
    needMods: 'Choose the mods folder first.',
  },
};
const text = TEXT[navigator.language.startsWith('fr') ? 'fr' : 'en'];

async function deploy(say) {
  const api = window.tessera;
  if (!(await api.external.info()).picked && !(await api.external.pick())) return say(text.needMods, true);
  say(text.deploying);
  const name = await api.export.deploy();
  say(text.deployed.replace('{name}', name));
  if (!(await api.exec.systemInfo().catch(() => ({}))).emulator) return;
  const game = String(api.settings.get('game') ?? '').trim().replace(/^"(.*)"$/, '$1');
  await api.exec.runSystem('emulator', game ? [game] : [], { detach: true });
}

let running = false;

window.tessera.on('titlebar', async ({ id }) => {
  if (id !== 'deploy' || running) return;
  running = true;
  const say = (message, error = false) => window.tessera.ui.toast(error ? 'error' : message === text.deploying ? 'info' : 'success', message);
  try {
    await deploy(say);
  } catch (error) {
    say(String(error.message ?? error), true);
  } finally {
    running = false;
  }
});
