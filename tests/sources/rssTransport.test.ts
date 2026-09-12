import { describe, expect, it, vi } from 'vitest';

import { ConfiguredSource } from '../../src/main/sources/configuredRssSource';
import { PublicRssSource } from '../../src/main/sources/publicRssSource';
import { createSystemRssFetcher } from '../../src/main/sources/rssTransport';

function fixture() {
  const fetcher = vi.fn<(input: Request, init?: object) => Promise<Response>>(async () => new Response('test'));
  const setProxy = vi.fn<(config: object) => Promise<void>>(async () => {});
  const createSession = vi.fn(() => ({ fetch: fetcher, setProxy }));
  return { fetcher, setProxy, createSession, transport: createSystemRssFetcher(createSession) };
}

describe('RSS system network transport', () => {
  it('initializes an isolated session lazily and configures OS proxy mode once', async () => {
    const f = fixture();
    expect(f.createSession).not.toHaveBeenCalled();
    await Promise.all([f.transport('https://rss.test/one'), f.transport('https://rss.test/two')]);
    expect(f.createSession).toHaveBeenCalledTimes(1);
    expect(f.setProxy).toHaveBeenCalledExactlyOnceWith({ mode: 'system' });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('omits credentials and caching, disables redirects and retains headers and cancellation', async () => {
    const f = fixture();
    const controller = new AbortController();
    await f.transport('https://rss.test/feed', {
      credentials: 'include', cache: 'force-cache', redirect: 'follow',
      headers: { 'user-agent': 'Tibo-Watch/test' }, signal: controller.signal,
    });
    const [request, options] = f.fetcher.mock.calls[0]!;
    expect(request.credentials).toBe('omit');
    expect(request.cache).toBe('no-store');
    expect(request.redirect).toBe('manual');
    expect(request.headers.get('user-agent')).toBe('Tibo-Watch/test');
    expect(options).toEqual({ bypassCustomProtocolHandlers: true });
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it('does not initialize or request anything while public RSS is disabled', async () => {
    const f = fixture();
    const source = new ConfiguredSource(new PublicRssSource({ fetcher: f.transport }), () => false);
    expect((await source.check({ checkedAt: new Date().toISOString(), signal: new AbortController().signal })).state).toBe('disabled');
    expect(f.createSession).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('does not send a request cancelled during proxy initialization', async () => {
    const f = fixture();
    let release!: () => void;
    f.setProxy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController();
    const pending = f.transport('https://rss.test/feed', { signal: controller.signal });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort();
    release();
    await expect(pending).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('allows retry after proxy initialization fails', async () => {
    const f = fixture();
    f.setProxy.mockRejectedValueOnce(new Error('temporary initialization failure'));
    await expect(f.transport('https://rss.test/feed')).rejects.toThrow('temporary');
    expect((await f.transport('https://rss.test/feed')).ok).toBe(true);
    expect(f.createSession).toHaveBeenCalledTimes(2);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});
