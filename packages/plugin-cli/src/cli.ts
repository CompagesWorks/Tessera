import { parseArgs } from 'node:util';
import { build } from './commands/build';
import { check } from './commands/check';
import { create } from './commands/new';
import { pack } from './commands/pack';
import { CliError, log } from './log';

const HELP = `tessera-plugin <command> [options]

Commands
  new <folder> [--rust] [--id x.y] [--name "Name"] [--author me] [--sdk path]
                         create a plugin (JavaScript, or Rust with --rust)
  build [folder] [--debug]
                         compile the Rust part to WebAssembly (pkg/)
  check [folder]         validate manifest.json and the files, like Tessera does
  pack [folder] [--out file.tessera-plugin] [--no-build]
                         build (Rust), check, then create a .tessera-plugin package

[folder] is a plugin folder, or a project with a tessera-plugin.json. Default: the current folder.`;

function main(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      rust: { type: 'boolean' },
      id: { type: 'string' },
      name: { type: 'string' },
      author: { type: 'string' },
      sdk: { type: 'string' },
      out: { type: 'string' },
      debug: { type: 'boolean' },
      'no-build': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, target] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  switch (command) {
    case 'new':
      if (!target) throw new CliError('usage: tessera-plugin new <folder> [--rust]');
      create(target, { rust: values.rust, id: values.id, name: values.name, author: values.author, sdk: values.sdk });
      return;
    case 'build':
      build(target, { debug: values.debug });
      return;
    case 'check':
      check(target);
      return;
    case 'pack':
      if (!values['no-build']) build(target);
      pack(target, values.out);
      return;
    default:
      throw new CliError(`unknown command "${command}"\n\n${HELP}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  log.fail(error instanceof CliError ? error.message : (error as Error).stack ?? String(error));
  process.exitCode = 1;
}
