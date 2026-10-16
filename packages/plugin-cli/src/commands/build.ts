import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CliError, log } from '../log';
import { loadProject } from '../project';

const WASM_BINDGEN = '0.2.129';

function run(command: string, args: string[], cwd: string, hint: string) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError(`${command} not found. ${hint}`);
  if (result.status !== 0) throw new CliError(`${command} ${args[0] ?? ''} failed`);
}

function crateName(rust: string): string {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: rust, encoding: 'utf8' });
  if (result.status !== 0) throw new CliError(`cargo metadata failed in ${rust}`);
  const metadata = JSON.parse(result.stdout) as { packages: Array<{ name: string; manifest_path: string }> };
  const crate = metadata.packages.find((p) => p.manifest_path.startsWith(rust)) ?? metadata.packages[0];
  if (!crate) throw new CliError(`no crate found in ${rust}`);
  return crate.name.replace(/-/g, '_');
}

export function build(dir?: string, options: { debug?: boolean } = {}) {
  const project = loadProject(dir);
  if (!project.rust) {
    log.ok('nothing to build: JavaScript plugins run as they are');
    return project;
  }
  if (!existsSync(join(project.rust, 'Cargo.toml'))) throw new CliError(`no Cargo.toml in ${project.rust}`);
  const profile = options.debug ? 'debug' : 'release';
  log.step(`cargo build (${profile}, wasm32-unknown-unknown)`);
  run('cargo', ['build', ...(options.debug ? [] : ['--release']), '--target', 'wasm32-unknown-unknown'], project.rust, 'Install Rust from https://rustup.rs, then run: rustup target add wasm32-unknown-unknown');
  const name = crateName(project.rust);
  const wasm = join(project.rust, 'target', 'wasm32-unknown-unknown', profile, `${name}.wasm`);
  if (!existsSync(wasm)) throw new CliError(`${wasm} was not produced: is crate-type = ["cdylib"] set in Cargo.toml?`);
  const out = join(project.plugin, 'pkg');
  rmSync(out, { recursive: true, force: true });
  log.step('wasm-bindgen --target web');
  run('wasm-bindgen', ['--target', 'web', '--no-typescript', '--out-dir', out, wasm], project.rust, `Install it with: cargo install wasm-bindgen-cli --version ${WASM_BINDGEN}`);
  log.ok(`pkg/${name}.js and pkg/${name}_bg.wasm written to ${project.plugin}`);
  return project;
}
