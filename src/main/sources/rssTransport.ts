import type { Session } from 'electron';

type RssSession = Pick<Session, 'fetch' | 'setProxy'>;

/** An isolated, in-memory Chromium session; never the renderer or Chrome profile. */
export function createSystemRssFetcher(createSession: () => RssSession): typeof fetch {
  let ready: Promise<RssSession> | null = null;
  const getSession = () => {
    if (!ready) {
      ready = Promise.resolve().then(async () => {
        const rssSession = createSession();
        // Explicit system mode honors OS proxy/PAC settings instead of Node's
        // direct fetch or command-line proxy overrides on the Electron process.
        await rssSession.setProxy({ mode: 'system' });
        return rssSession;
      }).catch(error => { ready = null; throw error; });
    }
    return ready;
  };

  return async (input, init) => {
    const request = new Request(input, {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'manual',
    });
    request.signal.throwIfAborted();
    const rssSession = await getSession();
    request.signal.throwIfAborted();
    return rssSession.fetch(request, { bypassCustomProtocolHandlers: true });
  };
}
