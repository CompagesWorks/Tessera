const greeting = document.getElementById('greeting');
const out = document.getElementById('out');

function show() {
  const { greeting: text, loud, size } = window.tessera.settings.get();
  greeting.textContent = loud ? String(text).toUpperCase() : text;
  greeting.style.fontSize = `${size}px`;
}

window.tessera.ready.then(() => {
  show();
  console.log('settings loaded', window.tessera.settings.get());
});
window.tessera.settings.onChange(show);

document.getElementById('write').addEventListener('click', async () => {
  try {
    const line = `${new Date().toISOString()} ${window.tessera.settings.get('greeting')}\n`;
    const previous = window.tessera.settings.get('mode') === 'append' ? await window.tessera.files.readText('demo.txt').catch(() => '') : '';
    await window.tessera.files.writeText('demo.txt', previous + line);
    out.textContent = 'demo.txt écrit';
  } catch (error) {
    out.textContent = String(error.message);
  }
});
document.getElementById('log').addEventListener('click', () => console.log('sayonara from the plugin', { at: Date.now() }));
document.getElementById('warn').addEventListener('click', () => console.warn('careful im in your house'));
document.getElementById('fail').addEventListener('click', () => {
  throw new Error('i am a evil error hello, boo lol haha so funny santa andagi');
});
