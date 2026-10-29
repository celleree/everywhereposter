import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { authClientIp, authProxyTrust, AUTH_RATE_LIMITED } from './auth-client-ip';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  private readonly authTrust = authProxyTrust(process.env.AUTH_TRUSTED_PROXY_CIDRS, process.env.FRONTEND_URL);
  private readonly authRequests = new WeakSet<object>();
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    // The router-selected handler owns the policy, independent of raw request-target syntax.
    const limitedAuth = this.reflector.get<boolean>(AUTH_RATE_LIMITED, context.getHandler()) === true;
    if (limitedAuth) this.authRequests.add(req);
    if (limitedAuth || (req.method === 'POST' && req.url.includes('/public/v1/posts'))) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    if (this.authRequests.has(req)) {
      return 'auth:' + authClientIp(req as Request, this.authTrust);
    }
    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}
