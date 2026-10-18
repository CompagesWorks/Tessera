import { afterEach, describe, expect, it, vi } from 'vitest';
import source from '../../../../resources/plugin-sdk.js?raw';

type Sdk = { files: { list(path: string): Promise<unknown> } };

function load() {
  const posted: { id: number; method: string }[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    if ((message as { method?: string }).method) posted.push(message as { id: number; method: string });
  });
  new Function(source)();
  return { sdk: (window as unknown as { tessera: Sdk }).tessera, posted };
}

const reply = (id: number, error: string) => window.dispatchEvent(new MessageEvent('message', { source: window, data: { tessera: 1, id, error } }));

describe('plugin sdk pacing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays under the bridge limit and keeps call order', async () => {
    vi.useFakeTimers();
    const { sdk, posted } = load();
    for (let i = 0; i < 80; i++) void sdk.files.list(`dir${i}`).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toHaveLength(35);
    await vi.advanceTimersByTimeAsync(1010);
    expect(posted).toHaveLength(70);
    await vi.advanceTimersByTimeAsync(1010);
    expect(posted.map((m) => (m as unknown as { params: { path: string } }).params.path)).toEqual(Array.from({ length: 80 }, (_, i) => `dir${i}`));
  });

  it('retries a rate-limited call', async () => {
    vi.useFakeTimers();
    const { sdk, posted } = load();
    const result = sdk.files.list('a');
    await vi.advanceTimersByTimeAsync(0);
    reply(posted[0]!.id, 'rate limited');
    await vi.advanceTimersByTimeAsync(1010);
    expect(posted).toHaveLength(2);
    reply(posted[1]!.id, 'denied');
    await expect(result).rejects.toThrow('denied');
  });
});
