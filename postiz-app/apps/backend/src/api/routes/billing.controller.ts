import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';
import { AiWalletRefundRequestDto } from '@gitroom/nestjs-libraries/dtos/billing/ai-wallet-refund-request.dto';
import { Body, Controller, Get, HttpException, Param, Post, Query, Req } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';
import { Nowpayments } from '@gitroom/nestjs-libraries/crypto/nowpayments';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { isBillingEnabled } from '@gitroom/helpers/utils/billing.enabled';
import { AiWalletTopupDto } from '@gitroom/nestjs-libraries/dtos/billing/ai-wallet-topup.dto';
import { AiWalletCheckoutService } from '@gitroom/nestjs-libraries/services/ai-wallet-checkout.service';

@ApiTags('Billing')
@Controller('/billing')
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _stripeService: StripeService,
    private _notificationService: NotificationService,
    private _nowpayments: Nowpayments,
    private walletCheckout: AiWalletCheckoutService,
    private refundRequests: AiWalletRefundRequestService
  ) {}

  private assertBillingEnabled() {
    if (!isBillingEnabled()) {
      throw new HttpException('Billing is disabled', 503);
    }
  }

  private assertBillingAdministrator(
    org: Organization & { users?: { role: string }[] }
  ) {
    if (!org.users?.[0] || !['ADMIN', 'SUPERADMIN'].includes(org.users[0].role)) {
      throw new HttpException('Organization billing administrator required', 403);
    }
  }

  @Get('/ai-wallet/refund-requests')
  walletRefundRequests(@GetOrgFromRequest() org: Organization) {
    return this.refundRequests.summary(org.id);
  }

  @Post('/ai-wallet/refund-requests')
  requestWalletRefund(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Body() body: AiWalletRefundRequestDto) {
    this.assertBillingAdministrator(org);
    return this.refundRequests.request(org.id, user.id, body.operationKey);
  }

  @Get('/ai-wallet/refund-review')
  walletRefundReview(@GetUserFromRequest() user: User, @Query('cursor') cursor?: string) {
    if (!user.isSuperAdmin) throw new HttpException('Platform administrator required', 403);
    return this.refundRequests.reviewQueue(cursor);
  }

  @Post('/ai-wallet/refund-requests/:id/withdraw')
  withdrawWalletRefund(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string) {
    this.assertBillingAdministrator(org);
    return this.refundRequests.resolve(org.id, id, user.id, 'WITHDRAWN');
  }

  @Post('/ai-wallet/refund-review/:organizationId/:id/reject')
  rejectWalletRefund(@GetUserFromRequest() user: User, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    if (!user.isSuperAdmin) throw new HttpException('Platform administrator required', 403);
    return this.refundRequests.resolve(organizationId, id, user.id, 'REJECTED');
  }

  @Post('/ai-wallet/refund-review/:organizationId/:id/test-reconciliation')
  reviewTestWalletRefund(@GetUserFromRequest() user: User, @Param('organizationId') organizationId: string,
    @Param('id') id: string, @Body() body: { topupId: string; chargeId: string; refundId: string }) {
    if (!user.isSuperAdmin) throw new HttpException('Platform administrator required', 403);
    return this.refundRequests.reviewTestTopup(organizationId, id, user.id, body);
  }

  @Get('/ai-wallet')
  walletBalance(@GetOrgFromRequest() org: Organization) {
    return this.walletCheckout.balance(org.id);
  }

  @Get('/ai-wallet/offers')
  walletOffers(@GetOrgFromRequest() org: Organization) {
    return this.walletCheckout.offers(org.id);
  }

  @Post('/ai-wallet/topups')
  createWalletTopup(
    @GetOrgFromRequest() org: Organization & { users: { role: string }[] },
    @Body() body: AiWalletTopupDto
  ) {
    if (!org.users?.[0] || !['ADMIN', 'SUPERADMIN'].includes(org.users[0].role)) {
      throw new HttpException('Organization billing administrator required', 403);
    }
    return this.walletCheckout.createCheckout(org.id, body.offerId, body.operationKey);
  }

  @Get('/check/:id')
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') body: string
  ) {
    return {
      status: await this._stripeService.checkSubscription(org.id, body),
    };
  }

  @Get('/check-discount')
  async checkDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      offerCoupon: !(await this._stripeService.checkDiscount(org.paymentId))
        ? false
        : AuthService.signJWT({ discount: true }),
    };
  }

  @Post('/apply-discount')
  async applyDiscount(@GetOrgFromRequest() org: Organization) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    await this._stripeService.applyDiscount(org.paymentId);
  }

  @Post('/finish-trial')
  async finishTrial(@GetOrgFromRequest() org: Organization) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    try {
      await this._stripeService.finishTrial(org.paymentId);
    } catch (err) {}
    return {
      finish: true,
    };
  }

  @Get('/is-trial-finished')
  async isTrialFinished(@GetOrgFromRequest() org: Organization) {
    return {
      finished: !org.isTrailing,
    };
  }

  @Post('/embedded')
  embedded(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    const uniqueId = req?.cookies?.track;
    return this._stripeService.embedded(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Post('/subscribe')
  subscribe(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    const uniqueId = req?.cookies?.track;
    return this._stripeService.subscribe(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Get('/portal')
  async modifyPayment(@GetOrgFromRequest() org: Organization) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    const customer = await this._stripeService.getCustomerByOrganizationId(
      org.id
    );
    const { url } = await this._stripeService.createBillingPortalLink(customer);
    return {
      portal: url,
    };
  }

  @Get('/')
  getCurrentBilling(@GetOrgFromRequest() org: Organization) {
    return this._subscriptionService.getSubscriptionByOrganizationId(org.id);
  }

  @Post('/cancel')
  async cancel(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: { feedback: string }
  ) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    const result = await this._stripeService.setToCancel(org.id);
    // Billing cancellation must not depend on notification delivery.
    try {
      await this._notificationService.sendEmail(
        process.env.EMAIL_FROM_ADDRESS,
        'Subscription Cancelled',
        `Organization ${org.name} has cancelled their subscription because: ${body.feedback}`,
        user.email
      );
    } catch {}
    return result;
  }

  @Post('/prorate')
  prorate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingSubscribeDto
  ) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    return this._stripeService.prorate(org.id, body);
  }

  @Post('/lifetime')
  async lifetime(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { code: string }
  ) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    return this._stripeService.lifetimeDeal(org.id, body.code);
  }

  @Get('/charges')
  async getCharges(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._stripeService.getCharges(org.id);
  }

  @Post('/refund-charges')
  async refundCharges(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Body() body: { chargeIds: string[] }
  ) {
    this.assertBillingEnabled();
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._stripeService.refundCharges(org.id, body.chargeIds);
  }

  @Post('/cancel-subscription')
  async cancelSubscription(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    this.assertBillingEnabled();
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._stripeService.cancelSubscription(org.id);
  }

  @Post('/add-subscription')
  async addSubscription(
    @Body() body: { subscription: string },
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    this.assertBillingEnabled();
    if (!user.isSuperAdmin) {
      throw new Error('Unauthorized');
    }

    await this._subscriptionService.addSubscription(
      org.id,
      user.id,
      body.subscription
    );
  }

  @Get('/crypto')
  async crypto(@GetOrgFromRequest() org: Organization) {
    this.assertBillingEnabled();
    this.assertBillingAdministrator(org);
    const subscription = await this._subscriptionService.getSubscription(org.id);
    if (!['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'].includes(subscription?.subscriptionTier || '')) {
      throw new HttpException('This payment method is unavailable for this plan', 403);
    }
    return this._nowpayments.createPaymentPage(org.id);
  }
}
