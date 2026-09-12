import { createServer as httpServer } from 'node:http';
import { connect, createServer as tcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemSmtpSocket, parseProxyRoutes } from '../../src/main/notifications/smtpProxy';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const policy = (initial: string) => ({
  setProxy: vi.fn(async () => {}), forceReloadProxyConfig: vi.fn(async () => {}),
  resolveProxy: vi.fn(async () => initial),
});
function open(getSocket: NonNullable<SMTPTransport.Options['getSocket']>, options: SMTPTransport.Options = {}) {
  return new Promise<{ connection?: Socket }>((resolve, reject) => getSocket({ host: 'smtp.example.com', port: 465, connectionTimeout: 1_000, ...options }, (error, socket) => error ? reject(error) : resolve(socket)));
}
async function listen(server: ReturnType<typeof httpServer> | ReturnType<typeof tcpServer>) {
  const sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return (server.address() as AddressInfo).port;
}

describe('system SMTP proxy selection', () => {
  it('reloads current OS policy for each connection, including switching to direct', async () => {
    const session = policy('DIRECT');
    const getSocket = createSystemSmtpSocket(() => session);
    expect(await open(getSocket)).toEqual({});
    session.resolveProxy.mockResolvedValue('SOCKS4 unsupported:1080');
    await expect(open(getSocket)).rejects.toMatchObject({ code: 'EMAIL_PROXY_UNSUPPORTED' });
    session.resolveProxy.mockResolvedValue('DIRECT');
    expect(await open(getSocket, { port: 587, secure: false })).toEqual({});
    expect(session.setProxy).toHaveBeenCalledExactlyOnceWith({ mode: 'system' });
    expect(session.forceReloadProxyConfig).toHaveBeenCalledTimes(3);
    expect(session.resolveProxy).toHaveBeenLastCalledWith('https://smtp.example.com:587/');
  });

  it('fails closed on policy errors and retries session initialization next time', async () => {
    const session = policy('DIRECT');
    session.setProxy.mockRejectedValueOnce(new Error('sensitive OS details'));
    const getSocket = createSystemSmtpSocket(() => session);
    await expect(open(getSocket)).rejects.toMatchObject({ message: 'EMAIL_PROXY_RESOLUTION_FAILED' });
    expect(await open(getSocket)).toEqual({});
    session.resolveProxy.mockRejectedValueOnce(new Error('private PAC URL'));
    await expect(open(getSocket)).rejects.toMatchObject({ message: 'EMAIL_PROXY_RESOLUTION_FAILED' });
    session.resolveProxy.mockImplementationOnce(() => new Promise(() => {}));
    await expect(open(getSocket, { connectionTimeout: 30 })).rejects.toMatchObject({ code: 'EMAIL_PROXY_TIMEOUT' });
  });

  it.each(['', 'PROXY user:secret@proxy:8080', 'PROXY proxy:0', 'PROXY proxy:65536', 'garbage', 'PROXY proxy:8080; unexpected'])('rejects invalid proxy policy %s', value => {
    expect(() => parseProxyRoutes(value)).toThrow();
  });

  it('parses ordered routes and bracketed IPv6 without injecting implicit DIRECT', () => {
    expect(parseProxyRoutes('PROXY localhost:7892; HTTPS [::1]:8443; SOCKS5 localhost:1080; DIRECT')).toEqual([
      { kind: 'http', host: 'localhost', port: 7892 }, { kind: 'https', host: '::1', port: 8443 },
      { kind: 'socks5', host: 'localhost', port: 1080 }, { kind: 'direct' },
    ]);
  });

  it('rejects invalid SMTP destinations before resolving policy', async () => {
    const session = policy('DIRECT');
    const getSocket = createSystemSmtpSocket(() => session);
    for (const host of ['smtp.example.com\r\nCookie: secret', 'user@example.com', 'smtp.example.com/path']) {
      await expect(open(getSocket, { host })).rejects.toMatchObject({ code: 'EMAIL_SERVER_INVALID' });
    }
    expect(session.resolveProxy).not.toHaveBeenCalled();
  });

  it('times out a silent proxy and closes the pending socket', async () => {
    let closed = false;
    const proxy = tcpServer(socket => { socket.on('data', () => {}); socket.on('close', () => { closed = true; }); });
    const port = await listen(proxy);
    await expect(open(createSystemSmtpSocket(() => policy(`PROXY 127.0.0.1:${port}`)), { connectionTimeout: 50 })).rejects.toMatchObject({ code: 'EMAIL_PROXY_TIMEOUT' });
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it('reports proxy authentication without sending SMTP credentials or falling back direct', async () => {
    const proxy = httpServer();
    const headers: unknown[] = [];
    proxy.on('connect', (request, socket) => { headers.push(request.headers); socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); });
    const port = await listen(proxy);
    await expect(open(createSystemSmtpSocket(() => policy(`PROXY 127.0.0.1:${port}; DIRECT`)), { auth: { user: 'sender@example.com', pass: 'secret' } })).rejects.toMatchObject({ code: 'EMAIL_PROXY_AUTH_REQUIRED' });
    expect(headers).toEqual([{ host: 'smtp.example.com:465', connection: 'close' }]);
  });

  it('follows explicit fallback order, but never adds a direct fallback itself', async () => {
    const proxy = httpServer();
    proxy.on('connect', (_request, socket) => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    const port = await listen(proxy);
    await expect(open(createSystemSmtpSocket(() => policy(`PROXY 127.0.0.1:${port}`)))).rejects.toMatchObject({ code: 'EMAIL_PROXY_UNAVAILABLE' });
    expect(await open(createSystemSmtpSocket(() => policy(`PROXY 127.0.0.1:${port}; DIRECT`)))).toEqual({});
  });
});

describe('real local SMTP through CONNECT', () => {
  it.each([true, false])('delivers with secure=%s while preserving destination TLS and authentication', async secure => {
    const messages: string[] = [];
    const tlsStates: boolean[] = [];
    const smtp = new SMTPServer({ secure,
      onAuth(auth, session, callback) {
        tlsStates.push(session.secure);
        if (auth.username !== 'sender@example.com' || auth.password !== 'synthetic-secret') return callback(new Error('fixture auth mismatch'));
        callback(null, { user: auth.username });
      },
      onData(stream, _session, callback) {
        let message = ''; stream.on('data', chunk => { message += chunk.toString(); });
        stream.on('end', () => { messages.push(message); callback(); });
      },
    });
    // Certificate failures below are expected and must not become unhandled server errors.
    smtp.on('error', () => {});
    const smtpPort = await listen(smtp.server);
    const headers: unknown[] = [];
    const wire: Buffer[] = [];
    const proxy = httpServer();
    proxy.on('connect', (request, socket, head) => {
      headers.push(request.headers);
      expect(request.url).toBe(`smtp-fixture.invalid:${smtpPort}`);
      const upstream = connect({ host: '127.0.0.1', port: smtpPort }, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.on('data', chunk => wire.push(chunk));
        socket.pipe(upstream).pipe(socket);
      });
      socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
    });
    const port = await listen(proxy);
    const getSocket = createSystemSmtpSocket(() => policy(`PROXY 127.0.0.1:${port}`));
    const options = { host: 'smtp-fixture.invalid', port: smtpPort, secure, requireTLS: !secure, getSocket,
      connectionTimeout: 1_000, greetingTimeout: 1_000, socketTimeout: 2_000,
      auth: { user: 'sender@example.com', pass: 'synthetic-secret' },
    };
    const strict = nodemailer.createTransport(options);
    // A tunnel must not imply "already secured" and bypass certificate validation.
    await expect(strict.verify()).rejects.toBeDefined(); strict.close();
    const fixture = nodemailer.createTransport({ ...options, tls: { rejectUnauthorized: false } });
    try {
      const result = await fixture.sendMail({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'local proxy fixture', text: 'synthetic message only' });
      expect(result.accepted).toEqual(['recipient@example.com']);
      expect(tlsStates).toEqual([true]);
      expect(messages).toHaveLength(1);
      expect(headers.every(header => !JSON.stringify(header).includes('synthetic-secret'))).toBe(true);
      expect(Buffer.concat(wire).toString()).not.toContain('synthetic-secret');
      expect(Buffer.concat(wire).toString()).not.toContain('synthetic message only');
    } finally { fixture.close(); }
  });

  it('handles fragmented SOCKS5 replies and asks the proxy to resolve the SMTP hostname', async () => {
    const names: string[] = [];
    const proxy = tcpServer(socket => {
      let greeted = false;
      socket.on('data', data => {
        if (!greeted) {
          expect([...data]).toEqual([5, 1, 0]); greeted = true;
          socket.write(Buffer.from([5])); setTimeout(() => socket.write(Buffer.from([0])), 5);
        } else {
          expect([...data.subarray(0, 4)]).toEqual([5, 1, 0, 3]);
          names.push(data.subarray(5, 5 + data[4]!).toString());
          socket.write(Buffer.from([5, 0, 0, 1]));
          setTimeout(() => socket.write(Buffer.from([127, 0, 0, 1, 0, 25])), 5);
        }
      });
    });
    const port = await listen(proxy);
    const result = await open(createSystemSmtpSocket(() => policy(`SOCKS5 127.0.0.1:${port}`)));
    expect(names).toEqual(['smtp.example.com']); result.connection?.destroy();
  });
});
