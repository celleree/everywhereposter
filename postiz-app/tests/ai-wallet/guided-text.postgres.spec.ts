import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AiWalletService } from '@gitroom/nestjs-libraries/database/prisma/ai-wallet/ai-wallet.service';
import { AiWalletTextService } from '@gitroom/nestjs-libraries/services/ai-wallet-text.service';
import { PrepaidCopyContextService } from '@gitroom/nestjs-libraries/services/prepaid-copy-context.service';
import { CopyGenerationModelService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.model.service';
import { CopyGenerationService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.service';
import { ImagePlanService } from '@gitroom/nestjs-libraries/copy-generation/image-plan.service';
import { AntiGenericService } from '@gitroom/nestjs-libraries/copy-generation/anti-generic.service';
jest.mock('openai', () => { const parse = jest.fn(); return { __esModule: true, parse,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { parse } } })) }; });
const fixture = process.env.AI_WALLET_TEST_DATABASE_URL;
const parse = (jest.requireMock('openai') as { parse: jest.Mock }).parse;
const rates = { inputUncachedLow:'2', inputCachedLow:'1', outputLow:'5', inputUncachedHigh:'4', inputCachedHigh:'2', outputHigh:'8' };
const cards = Object.fromEntries(['gpt-6-luna','gpt-6.1-sol'].map(m => [m, { rateVersion:'fixture-v1', per:'1', rates,
  billingContext:'standard-text-receipt-no-extra-charges' }]));
(fixture ? describe : describe.skip)('guided text models through real durable wallet', () => {
  let db: PrismaClient, wallet: AiWalletService, scope: PrepaidCopyContextService, model: CopyGenerationModelService, org: string;
  let subscriptions: any, body: any;
  const before = { ...process.env };
  const collect = async (g: AsyncGenerator<any>) => { const events=[]; for await (const e of g) events.push(e); return events; };
  beforeAll(async () => { const u=new URL(fixture!); if (!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!='/ep_ai_wallet_test') throw Error('Disposable fixture required');
    db=new PrismaClient({datasources:{db:{url:fixture}}});await db.$connect(); });
  beforeEach(async () => {
    Object.assign(process.env,{BILLING_ENABLED:'true',AI_WALLET_ENABLED:'true',AI_WALLET_TEXT_ENABLED:'true',AI_WALLET_TEXT_RATE_CARDS:JSON.stringify(cards)});
    org=randomUUID();body={requestKey:randomUUID(),mediaId:'fixture-media',platforms:['linkedin'],goal:'position'};
    await db.organization.create({data:{id:org,name:'Offline guided text'}});await db.aiWallet.create({data:{organizationId:org,balanceNanos:100000000n}});
    wallet=new AiWalletService({model:db} as any);subscriptions={getSubscriptionByOrganizationId:jest.fn(async()=>({subscriptionTier:'LAUNCH_V1'}))};
    scope=new PrepaidCopyContextService(subscriptions,wallet,new AiWalletTextService(wallet));model=new CopyGenerationModelService(scope);
    parse.mockReset().mockImplementation(async req => ({id:randomUUID(),model:req.model,service_tier:'default',
      choices:[{finish_reason:'stop',message:{parsed:req.response_format.json_schema.name==='transcriptInsights'
        ?{transcriptSummary:'Labels are handwritten.',facts:['Labels are handwritten','Stock is checked twice'],unknowns:[],coreMessage:'Check details.',voiceProfile:null}
        :{draft:'We hand-label small batches and check the stock twice before shipping.',angle:'Specific lesson',hook:'Check details',cta:''}}}],
      usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,prompt_tokens_details:{cached_tokens:2},completion_tokens_details:{reasoning_tokens:1}}}));
  });
  afterAll(async()=>{for(const k of ['BILLING_ENABLED','AI_WALLET_ENABLED','AI_WALLET_TEXT_ENABLED','AI_WALLET_TEXT_RATE_CARDS']) before[k]===undefined?delete process.env[k]:process.env[k]=before[k];await db?.$disconnect();});
  const stages=async function*(m:CopyGenerationModelService){
    yield 'start';await m.summarizeTranscript('Handwritten labels and two stock checks.');
    const brief:any={platform:{name:'LinkedIn',targetCharacters:300,hashtags:'none',lineBreaks:'moderate',ctaStyle:'none'},strategy:{coreMessage:'Check details'},source:{facts:['Handwritten labels']}};
    const draft=await m.generatePlatformDraft(brief,'Write grounded copy','Be specific');
    yield await m.rewriteDraft({brief,draft:draft.draft,reasons:['Specificity'],targetCharacters:300,hardCap:3000});
  };
  it('meters analysis, draft and rewrite with no SDK retry and replays after flags/plan pause',async()=>{
    const first=await collect(scope.scope(org,body,()=>stages(model)));expect(parse).toHaveBeenCalledTimes(3);
    for(const [req,opts] of parse.mock.calls){expect(req).toMatchObject({max_completion_tokens:4096,n:1,service_tier:'default'});expect(opts).toMatchObject({maxRetries:0});}
    process.env.AI_WALLET_ENABLED='false';process.env.AI_WALLET_TEXT_ENABLED='false';subscriptions.getSubscriptionByOrganizationId.mockResolvedValue({subscriptionTier:'STANDARD'});
    expect(await collect(scope.scope(org,body,()=>stages(model)))).toEqual(first);expect(parse).toHaveBeenCalledTimes(3);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(3);
  });
  it('isolates concurrent organizations and rejects changed source before a second paid call',async()=>{
    await collect(scope.scope(org,body,()=>stages(model)));
    await expect(collect(scope.scope(org,{...body,audience:'changed'},()=>stages(model)))).rejects.toThrow('different inputs');
    expect(parse).toHaveBeenCalledTimes(3);
    const other=randomUUID();await db.organization.create({data:{id:other,name:'Other org'}});await db.aiWallet.create({data:{organizationId:other,balanceNanos:100000000n}});
    await Promise.all([collect(scope.scope(org,body,()=>stages(model))),collect(scope.scope(other,body,()=>stages(model)))]);
    expect(parse).toHaveBeenCalledTimes(6);expect(scope.active).toBe(false);
  });
  it('blocks default-off/new-free paths and visual/image planning before any provider call',async()=>{
    process.env.AI_WALLET_TEXT_ENABLED='false';await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('disabled');
    process.env.AI_WALLET_TEXT_ENABLED='true';subscriptions.getSubscriptionByOrganizationId.mockResolvedValue(null);
    await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('unavailable');
    subscriptions.getSubscriptionByOrganizationId.mockResolvedValue({subscriptionTier:'LAUNCH_V1'});
    await collect(scope.scope(org,body,async function*(){
      await expect(model.analyzeImage({buffer:Buffer.from('offline'),mimeType:'image/png'})).rejects.toThrow('unavailable');
      await expect(model.analyzeVideoFrames({inputPath:'/offline',mimeType:'video/mp4'})).rejects.toThrow('unavailable');
      await expect(new ImagePlanService(undefined,scope).generate({media:{mediaType:'video'}} as any,['linkedin'])).rejects.toThrow('unavailable');yield 'blocked';
    }));expect(parse).not.toHaveBeenCalled();
  });
  it('wraps the real copy generator so its platform model is metered',async()=>{
    const source={assertMediaAccess:jest.fn(),build:jest.fn(async()=>({media:{id:'fixture-media',path:'/offline',mediaType:'image',mimeType:'image/png'},source:{mediaType:'image',visualSummary:'Supplied notes',facts:['Handwritten labels','Two stock checks'],unknowns:[]},coreMessage:'Check details',sourceConfidence:0.8,warnings:[],storedKnowledgeBaseFacts:[],overlapReferenceTexts:[],blocked:false}))};
    const service=new CopyGenerationService(source as any,new AntiGenericService(),model,undefined,scope);
    const events=await collect(service.generate(org,body));expect(events.at(-1)).toMatchObject({name:'completed',data:{requestId:body.requestKey,status:'complete'}});
    expect(await db.aiWalletReservation.count({where:{organizationId:org,state:'SETTLED'}})).toBeGreaterThan(0);
    for(const [,opts] of parse.mock.calls) expect(opts).toMatchObject({maxRetries:0});
  });
});
