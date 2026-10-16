import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletRefundRequestService } from '@gitroom/nestjs-libraries/services/ai-wallet-refund-request.service';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { PREPAID_AI_POLICY } from '@gitroom/nestjs-libraries/services/ai-wallet-pricing';
const fixture=process.env.AI_WALLET_TEST_DATABASE_URL;
(fixture?describe:describe.skip)('non-expiring unused-credit requests in disposable PostgreSQL',()=>{
  let db:PrismaClient, service:AiWalletRefundRequestService, wallet:AiWalletService, org:string;
  const oldBilling=process.env.BILLING_ENABLED,oldWallet=process.env.AI_WALLET_ENABLED;
  const key=()=>`request_${randomUUID()}`;
  const fund=async(cents=1000, organizationId=org)=>{
    const amount=BigInt(cents)*10000000n;
    await db.$transaction(async tx=>{
      const topup=await tx.aiWalletTopup.create({data:{organizationId,operationKey:randomUUID(),customerId:'synthetic-test-customer',sessionId:`cs_synthetic_${randomUUID()}`,paymentId:`pi_synthetic_${randomUUID()}`,amountCents:cents,currency:'usd',createdAt:new Date('2000-01-01'),fundedAt:new Date('2000-01-01')}});
      await tx.aiWalletLedger.create({data:{organizationId,externalKey:randomUUID(),kind:'FUNDING',topupId:topup.id,amountNanos:amount,createdAt:new Date('2000-01-01')}});
      await tx.aiWallet.update({where:{organizationId},data:{balanceNanos:{increment:amount}}});
    });
  };
  beforeAll(async()=>{const u=new URL(fixture!);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!='/ep_ai_wallet_test')throw Error('Disposable fixture required');db=new PrismaClient({datasources:{db:{url:fixture}}});await db.$connect();});
  beforeEach(async()=>{process.env.BILLING_ENABLED='true';process.env.AI_WALLET_ENABLED='true';service=new AiWalletRefundRequestService({model:db} as any);wallet=new AiWalletService({model:db} as any);org=randomUUID();await db.organization.create({data:{id:org,name:'Synthetic refund-request org'}});await db.aiWallet.create({data:{organizationId:org}});await fund();});
  afterAll(async()=>{oldBilling===undefined?delete process.env.BILLING_ENABLED:process.env.BILLING_ENABLED=oldBilling;oldWallet===undefined?delete process.env.AI_WALLET_ENABLED:process.env.AI_WALLET_ENABLED=oldWallet;await db?.$disconnect();});
  it('keeps aged purchased value, records a request with flags off and makes no payment/debit',async()=>{
    expect(PREPAID_AI_POLICY.creditsExpire).toBe(false);process.env.BILLING_ENABLED='false';process.env.AI_WALLET_ENABLED='false';
    expect(await service.summary(org)).toMatchObject({creditsExpire:false,eligibleNanos:'10000000000'});
    const row=await service.request(org,'synthetic-user',key());expect(row).toMatchObject({status:'REQUESTED',requestedNanos:'10000000000'});
    expect(await db.aiWallet.findUnique({where:{organizationId:org}})).toMatchObject({balanceNanos:10000000000n,heldNanos:10000000000n});
    expect(await db.aiWalletLedger.count({where:{organizationId:org,kind:'USAGE'}})).toBe(0);
  });
  it('excludes unknown spend holds and prevents the requested funds from being spent',async()=>{
    const held=await wallet.reserve(org,'offline-held','openai','fixture',2000000000n);await wallet.dispatch(org,held.id);await wallet.markUnknown(org,held.id);
    expect(await service.request(org,'synthetic-user',key())).toMatchObject({requestedNanos:'8000000000'});
    expect(await service.summary(org)).toMatchObject({eligibleNanos:'0',usageHeldNanos:'2000000000',refundHeldNanos:'8000000000'});
    await expect(wallet.reserve(org,'cannot-spend','openai','fixture',1n)).rejects.toThrow('Insufficient');
    expect(await wallet.quotedOperation(org,'offline-held')).toMatchObject({state:'UNKNOWN'});
  });
  it('subtracts settled usage from purchased value',async()=>{
    const held=await wallet.reserve(org,'offline-spend','openai','fixture',3000000000n);await wallet.dispatch(org,held.id);await wallet.settle(org,held.id,2000000000n,`synthetic-provider-${randomUUID()}`);
    expect(await service.request(org,'synthetic-user',key())).toMatchObject({requestedNanos:'8000000000'});
  });
  it('serializes identical and competing keys without reserving the same value twice',async()=>{
    const operation=key();const rows=await Promise.all([service.request(org,'u',operation),service.request(org,'u',operation),service.request(org,'u',operation)]);expect(new Set(rows.map(r=>r.id)).size).toBe(1);
    await expect(service.request(org,'u',key())).rejects.toThrow('No unused');expect(await db.aiWalletRefundRequest.count({where:{organizationId:org}})).toBe(1);
    const other=randomUUID();await db.organization.create({data:{id:other,name:'Other synthetic org'}});await db.aiWallet.create({data:{organizationId:other}});await fund(500,other);
    const competing=await Promise.allSettled([service.request(other,'u',key()),service.request(other,'u',key())]);expect(competing.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  it.each(['REVIEW','ledger-drift'])('rejects %s without overstating or mutating availability',async kind=>{
    await db.aiWallet.update({where:{organizationId:org},data:kind==='REVIEW'?{status:'REVIEW'}:{balanceNanos:{increment:1n}}});
    expect(await service.summary(org)).toMatchObject({eligibleNanos:'0',requiresReconciliation:true});
    await expect(service.request(org,'u',key())).rejects.toThrow('reconciliation');expect(await db.aiWalletRefundRequest.count({where:{organizationId:org}})).toBe(0);
  });
  it('isolates organizations and permits another request only for newly funded available value',async()=>{
    const operation=key(),first=await service.request(org,'u',operation);expect(await service.summary('different-org')).toMatchObject({purchasedNanos:'0',requests:[]});
    await expect(service.request('different-org','u',operation)).rejects.toThrow('reconciliation');
    await fund(500);const second=await service.request(org,'u',key());expect(second.requestedNanos).toBe('5000000000');expect(second.id).not.toBe(first.id);
    expect((await service.request(org,'u',operation)).id).toBe(first.id);
  });
  it('rolls back both the request and hold when the local transaction fails before commit',async()=>{
    const broken=new AiWalletRefundRequestService({model:{$transaction:(fn:any,opts:any)=>db.$transaction(async tx=>{await fn(tx);throw Error('synthetic local commit failure');},opts)}} as any);
    await expect(broken.request(org,'u',key())).rejects.toThrow('commit failure');
    expect(await db.aiWalletRefundRequest.count({where:{organizationId:org}})).toBe(0);
    expect(await db.aiWallet.findUnique({where:{organizationId:org}})).toMatchObject({heldNanos:0n,balanceNanos:10000000000n});
  });
});
