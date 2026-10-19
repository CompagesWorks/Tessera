const CONFIG_DIR_RULES = [
  [/^camera\/fighter\/([^/]+)\/(c\d+)\//, 'fighter/$1/$2/camera'],
  [/^fighter\/([^/]+)\/(?:.+\/)?(c\d+)\//, 'fighter/$1/$2'],
  [/^effect\/fighter\/([^/]+)\/(?:.*[_/])?(c\d+)(?=[._/])/, 'fighter/$1/$2'],
  [/^sound\/bank\/fighter(?:_voice)?\/(?:se|vc)_(.+?)_(c\d+)\./, 'fighter/$1/$2'],
];

function configDirOf(path) {
  for (const [rule, dir] of CONFIG_DIR_RULES) {
    const match = rule.exec(path);
    if (match) return dir.replace(/\$(\d)/g, (_, index) => match[index]);
  }
  const slash = path.lastIndexOf('/');
  if (slash <= 0) throw new Error('no-dir');
  return path.slice(0, slash);
}

function addToConfig(text, filePath) {
  const path = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = configDirOf(path);
  let config = {};
  if (text.trim()) {
    try {
      config = JSON.parse(text);
    } catch {
      throw new Error('invalid-config');
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid-config');
  const files = config['new-dir-files'] ?? {};
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('invalid-config');
  const lower = path.toLowerCase();
  for (const list of Object.values(files)) {
    if (!Array.isArray(list)) throw new Error('invalid-config');
    if (list.some((entry) => String(entry).toLowerCase() === lower)) return { added: false, dir, text };
  }
  files[dir] = [...(files[dir] ?? []), path];
  config['new-dir-files'] = files;
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '    ';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out = JSON.stringify(config, null, indent).replace(/\n/g, eol);
  return { added: true, dir, text: text && !/\r?\n$/.test(text) ? out : out + eol };
}
