import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { authClientIp, authProxyTrust, isLimitedAuthRequest } from './auth-client-ip';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  private readonly authTrust = authProxyTrust(process.env.AUTH_TRUSTED_PROXY_CIDRS, process.env.FRONTEND_URL);
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (isLimitedAuthRequest({ method, url } as Request) ||
        (method === 'POST' && url.includes('/public/v1/posts'))) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    if (isLimitedAuthRequest(req as Request)) {
      return 'auth:' + authClientIp(req as Request, this.authTrust);
    }
    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}
