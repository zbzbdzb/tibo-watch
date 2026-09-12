import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, isIP, type Socket } from 'node:net';
import type { Session } from 'electron';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

type ProxySession = Pick<Session, 'setProxy' | 'resolveProxy' | 'forceReloadProxyConfig'>;
type Route = { kind:'direct' } | { kind:'http'|'https'|'socks5'; host:string; port:number };
const failure = (code:string) => Object.assign(new Error(code), {code});

/** Chromium resolves OS/PAC policy; only the resulting TCP tunnel is handed to
 * Nodemailer. No cookies, browser sessions, SMTP AUTH or message bytes go through
 * Chromium. Nodemailer still performs end-to-end TLS and certificate validation.
 */
export function createSystemSmtpSocket(createSession:()=>ProxySession): NonNullable<SMTPTransport.Options['getSocket']> {
  let ready:Promise<ProxySession>|null=null;
  const getSession=()=>ready ??= Promise.resolve().then(async()=>{
    const session=createSession();
    await session.setProxy({mode:'system'});
    return session;
  }).catch(error=>{ready=null;throw error;});

  return (options,callback)=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),options.connectionTimeout ?? 15_000);
    const open=async()=>{
      const target=destination(String(options.host ?? ''),Number(options.port ?? (options.secure?465:587)));
      let policy:string;
      try {
        // Re-resolve for every connection: proxy port/mode/PAC can change while
        // the desktop app remains running. Never cache a concrete proxy address.
        const session=await abortable(getSession(),controller.signal);
        await abortable(session.forceReloadProxyConfig(),controller.signal);
        // Both SMTPS and required STARTTLS use the system's secure-proxy policy.
        policy=await abortable(session.resolveProxy(`https://${target.authority}/`),controller.signal);
      } catch {throw failure(controller.signal.aborted?'EMAIL_PROXY_TIMEOUT':'EMAIL_PROXY_RESOLUTION_FAILED');}
      const routes=parseProxyRoutes(policy);
      let last:unknown=failure('EMAIL_PROXY_UNAVAILABLE');
      for (const route of routes) {
        if(controller.signal.aborted)throw failure('EMAIL_PROXY_TIMEOUT');
        // DIRECT is allowed only when explicitly present in OS/PAC policy.
        if(route.kind==='direct')return {};
        try {
          const connection=route.kind==='socks5'
            ? await socksTunnel(route,target,controller.signal)
            : await httpTunnel(route,target,controller.signal);
          return {connection};
        } catch(error) {
          last=error;
          if(error instanceof Error && 'code' in error && error.code==='EMAIL_PROXY_AUTH_REQUIRED')throw error;
        }
      }
      throw last;
    };
    void open().then(socket=>{clearTimeout(timeout);callback(null,socket);},error=>{
      clearTimeout(timeout);callback(error instanceof Error?error:failure('EMAIL_PROXY_UNAVAILABLE'),{});
    });
  };
}

function abortable<T>(pending:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    const aborted=()=>reject(failure('EMAIL_PROXY_TIMEOUT'));
    if(signal.aborted){reject(failure('EMAIL_PROXY_TIMEOUT'));return;}
    signal.addEventListener('abort',aborted,{once:true});
    pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
  });
}

function destination(host:string,port:number):{host:string;port:number;authority:string} {
  if(!host || /[\s/@?#\\]/.test(host) || !Number.isInteger(port) || port<1 || port>65535)throw failure('EMAIL_SERVER_INVALID');
  const raw=host.replace(/^\[|\]$/g,'');
  if(raw.includes(':') && isIP(raw)!==6)throw failure('EMAIL_SERVER_INVALID');
  const url=new URL(`https://${isIP(raw)===6?`[${raw}]`:raw}:${port}/`);
  const normalized=url.hostname.replace(/^\[|\]$/g,'');
  return {host:normalized,port,authority:`${isIP(normalized)===6?`[${normalized}]`:normalized}:${port}`};
}

export function parseProxyRoutes(policy:string):Route[] {
  if(!policy.trim())throw failure('EMAIL_PROXY_RESOLUTION_FAILED');
  return policy.split(';').map(value=>{
    if(value.trim()==='DIRECT')return {kind:'direct'};
    const match=/^(PROXY|HTTPS|SOCKS5)\s+(\[[0-9a-f:]+\]|[^\s:/@?#]+):(\d+)$/i.exec(value.trim());
    if(!match)throw failure('EMAIL_PROXY_UNSUPPORTED');
    const target=destination(match[2]!,Number(match[3]));
    return {kind:match[1]!.toUpperCase()==='PROXY'?'http':match[1]!.toUpperCase()==='HTTPS'?'https':'socks5',host:target.host,port:target.port};
  });
}

function httpTunnel(route:Exclude<Route,{kind:'direct'}>,target:ReturnType<typeof destination>,signal:AbortSignal):Promise<Socket> {
  return new Promise((resolve,reject)=>{
    const req=(route.kind==='https'?httpsRequest:httpRequest)({hostname:route.host,port:route.port,method:'CONNECT',path:target.authority,
      headers:{Host:target.authority},agent:false,maxHeaderSize:16*1024});
    let settled=false;
    const done=(error?:Error,socket?:Socket)=>{
      if(settled){socket?.destroy();return;}
      settled=true;signal.removeEventListener('abort',aborted);
      if(error){req.destroy();socket?.destroy();reject(error);}else resolve(socket!);
    };
    const aborted=()=>done(failure('EMAIL_PROXY_TIMEOUT'));
    signal.addEventListener('abort',aborted,{once:true});
    req.once('error',()=>done(failure('EMAIL_PROXY_UNAVAILABLE')));
    req.once('connect',(response,socket,head)=>{
      if(response.statusCode!==200){done(failure(response.statusCode===407?'EMAIL_PROXY_AUTH_REQUIRED':'EMAIL_PROXY_UNAVAILABLE'),socket);return;}
      socket.pause();if(head.length)socket.unshift(head);
      done(undefined,socket);
    });
    req.once('response',response=>{response.destroy();done(failure('EMAIL_PROXY_UNAVAILABLE'));});
    if(signal.aborted)aborted();else req.end();
  });
}

/** SOCKS5 no-auth, with destination DNS resolved by the configured proxy. */
function socksTunnel(route:Exclude<Route,{kind:'direct'}>,target:ReturnType<typeof destination>,signal:AbortSignal):Promise<Socket> {
  return new Promise((resolve,reject)=>{
    const socket=connect({host:route.host,port:route.port});
    let buffer=Buffer.alloc(0),stage:'greeting'|'connect'='greeting',settled=false;
    const failed=()=>done(failure('EMAIL_PROXY_UNAVAILABLE'));
    const aborted=()=>done(failure('EMAIL_PROXY_TIMEOUT'));
    const done=(error?:Error)=>{
      if(settled)return;settled=true;
      signal.removeEventListener('abort',aborted);socket.removeListener('data',data);socket.removeListener('error',failed);socket.removeListener('end',failed);
      if(error){socket.destroy();reject(error);}else{socket.pause();if(buffer.length)socket.unshift(buffer);resolve(socket);}
    };
    const data=(chunk:Buffer)=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length>16*1024){failed();return;}
      if(stage==='greeting') {
        if(buffer.length<2)return;
        if(buffer[0]!==5){failed();return;}
        if(buffer[1]!==0){done(failure('EMAIL_PROXY_AUTH_REQUIRED'));return;}
        buffer=buffer.subarray(2);stage='connect';
        const name=Buffer.from(target.host,'utf8');
        if(name.length>255){done(failure('EMAIL_SERVER_INVALID'));return;}
        socket.write(Buffer.concat([Buffer.from([5,1,0,3,name.length]),name,Buffer.from([target.port>>8,target.port&255])]));
      }
      if(buffer.length<5)return;
      if(buffer[0]!==5 || buffer[1]!==0 || buffer[2]!==0){failed();return;}
      const size=buffer[3]===1?10:buffer[3]===4?22:buffer[3]===3?7+buffer[4]!:0;
      if(!size){failed();return;}if(buffer.length<size)return;
      buffer=buffer.subarray(size);done();
    };
    signal.addEventListener('abort',aborted,{once:true});
    socket.once('connect',()=>socket.write(Buffer.from([5,1,0])));
    socket.on('data',data);socket.on('error',failed);socket.once('end',failed);
    if(signal.aborted)aborted();
  });
}
