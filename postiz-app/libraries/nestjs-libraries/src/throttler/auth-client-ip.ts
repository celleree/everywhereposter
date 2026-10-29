import { applyDecorators, BadRequestException, SetMetadata } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

const publicFrontend = (url?: string) => {
  if (!url) return false;
  const host = new URL(url).hostname;
  return !['localhost', '127.0.0.1', '[::1]'].includes(host);
};

export function authProxyTrust(cidrs = '', frontend?: string): BlockList {
  if (!cidrs.trim() && publicFrontend(frontend)) {
    throw new Error('Public authentication requires AUTH_TRUSTED_PROXY_CIDRS');
  }
  const trust = new BlockList();
  for (const entry of cidrs.split(',').map((value) => value.trim()).filter(Boolean)) {
    const parts = entry.split('/');
    const family = isIP(parts[0]);
    const bits = family === 4 ? 32 : 128;
    const prefix = parts.length === 1 ? bits : Number(parts[1]);
    if (!family || parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1])) ||
        prefix <= 0 || prefix > bits || parts[1] === '' ||
        parts[0].toLowerCase().startsWith('::ffff:')) {
      throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS; use explicit IPv4/IPv6 addresses or CIDRs');
    }
    trust.addSubnet(parts[0], prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return trust;
}

function canonicalIp(value: string): string {
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6 || value.includes('%')) throw new BadRequestException('Invalid client address');
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/.exec(ip);
  if (!mapped) return ip;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function authClientIp(req: Pick<Request, 'socket' | 'headers'>, trust: BlockList): string {
  let client = canonicalIp(req.socket.remoteAddress ?? '');
  const trusted = (ip: string) => trust.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  // Never use req.ip, CF-Connecting-IP or a forwarded address from an untrusted peer.
  if (!trusted(client)) return client;
  const header = req.headers['x-forwarded-for'];
  if (typeof header !== 'string' || !header || header.length > 2048) {
    throw new BadRequestException('Trusted authentication proxy requires X-Forwarded-For');
  }
  const chain = header.split(',');
  if (chain.length > 32) throw new BadRequestException('Forwarding chain too long');
  for (let index = chain.length - 1; index >= 0 && trusted(client); index--) {
    client = canonicalIp(chain[index].trim());
  }
  return client;
}

export const AUTH_RATE_LIMITS = {
  login: { default: { limit: 10, ttl: 60_000, blockDuration: 60_000 } },
  recovery: { default: { limit: 5, ttl: 900_000, blockDuration: 900_000 } },
};

export const AUTH_RATE_LIMITED = 'auth-rate-limited';
export const AuthRateLimit = (options: Parameters<typeof Throttle>[0]) =>
  applyDecorators(SetMetadata(AUTH_RATE_LIMITED, true), Throttle(options));
