const log = document.getElementById('log');

function show(label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  log.textContent = `${label}\n${text}\n\n${log.textContent}`.slice(0, 4000);
}

function action(id, label, run) {
  document.getElementById(id).addEventListener('click', async () => {
    try {
      show(label, await run());
    } catch (error) {
      show(`${label} : erreur`, error.message);
    }
  });
}

action('write', 'files.writeText', async () => {
  await tessera.files.writeText('toolbox.txt', `Écrit par Toolbox le ${new Date().toLocaleString()}\n`);
  return tessera.files.readText('toolbox.txt');
});

action('private', 'files.private', async () => {
  const runs = Number((await tessera.files.private.readText('runs.txt').catch(() => '0')) || 0) + 1;
  await tessera.files.private.writeText('runs.txt', String(runs));
  return `runs = ${runs}`;
});

action('pick', 'external.pick', async () => {
  await tessera.external.pick();
  return tessera.external.info();
});

action('external', 'external.list', async () => (await tessera.external.list('')).map((e) => `${e.kind === 'dir' ? '📁' : '📄'} ${e.name}`).join('\n'));

action('github', 'net.fetch', async () => {
  const response = await tessera.net.fetch('https://api.github.com/zen');
  return `${response.status} ${response.body}`;
});

action('blocked', 'net.fetch', () => tessera.net.fetch('https://example.com/'));

action('save', 'secrets.set', async () => {
  await tessera.secrets.set('token', document.getElementById('secret').value);
  return tessera.secrets.keys();
});

action('load', 'secrets.get', () => tessera.secrets.get('token'));

action('pickGit', 'exec.pickSystem', async () => {
  await tessera.exec.pickSystem('git');
  return tessera.exec.systemInfo();
});

action('gitVersion', 'exec.runSystem', async () => (await tessera.exec.runSystem('git', ['--version'])).stdout);

action('copy', 'clipboard.writeText', async () => {
  await tessera.clipboard.writeText('Copié par Toolbox');
  return 'ok';
});

action('notify', 'notify.show', async () => {
  await tessera.notify.show('Coucou', 'Notification envoyée par Toolbox');
  return 'ok';
});

action('open', 'shell.openUrl', async () => {
  await tessera.shell.openUrl('https://github.com/');
  return 'ok';
});

action('reveal', 'shell.reveal', async () => {
  await tessera.shell.reveal('');
  return 'ok';
});

action('projects', 'projects.list', async () => (await tessera.projects.list()).map((p) => `${p.name} · ${p.kind} · ${p.status}`).join('\n'));

tessera.ready.then(() => {
  tessera.files.watch(({ paths }) => show('files.changed', paths.join('\n')));
});
