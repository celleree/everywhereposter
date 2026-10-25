import { PermissionsService } from '../../apps/backend/src/services/auth/permissions/permissions.service';
import { PoliciesGuard } from '../../apps/backend/src/services/auth/permissions/permissions.guard';
import { AuthorizationActions, Sections } from '../../apps/backend/src/services/auth/permissions/permission.exception.class';
import { requestMediaCopyGeneration } from '../../apps/frontend/src/components/new-launch/copy-generation.client';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
const mockSubscriptions = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  subscriptions: { list: (...args: any[]) => mockSubscriptions(...args) },
})) }));
jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
import { PrismaClient } from '@prisma/client';
import { randomUUID, webcrypto } from 'crypto';
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
    await db.organization.create({data:{id:org,name:'Offline guided text',paymentId:`cus_${org}`,allowTrial:false,
      subscription:{create:{subscriptionTier:'LAUNCH_V1',totalChannels:0,period:'MONTHLY'}}}});await db.aiWallet.create({data:{organizationId:org,balanceNanos:100000000n}});
    wallet=new AiWalletService({model:db} as any);const repository={model:db} as any;
    subscriptions=new SubscriptionRepository(repository,repository,repository,repository,repository);
    scope=new PrepaidCopyContextService(subscriptions,wallet,new AiWalletTextService(wallet));model=new CopyGenerationModelService(scope);
    parse.mockReset().mockImplementation(async req => ({id:randomUUID(),model:req.model,service_tier:'default',
      choices:[{finish_reason:'stop',message:{parsed:req.response_format.json_schema.name==='transcriptInsights'
        ?{transcriptSummary:'Labels are handwritten.',facts:['Labels are handwritten','Stock is checked twice'],unknowns:[],coreMessage:'Check details.',voiceProfile:null}
        :{draft:'We hand-label small batches and check the stock twice before shipping.',angle:'Specific lesson',hook:'Check details',cta:''}}}],
      usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,prompt_tokens_details:{cached_tokens:2},completion_tokens_details:{reasoning_tokens:1}}}));
  });
  afterAll(async()=>{for(const k of ['BILLING_ENABLED','AI_WALLET_ENABLED','AI_WALLET_TEXT_ENABLED','AI_WALLET_TEXT_RATE_CARDS']) before[k]===undefined?delete process.env[k]:process.env[k]=before[k];await db?.$disconnect();});
  const guardFor=(organizationId:string,requestKey:string)=>{
    const permissions=new PermissionsService(subscriptions,{countPostsFromDay:async()=>999999} as any,{} as any,{} as any,wallet);
    const handlers=[[AuthorizationActions.Create,Sections.POSTS_PER_MONTH],[AuthorizationActions.Create,Sections.GUIDED_COPY]];
    const guard=new PoliciesGuard({get:()=>handlers} as any,permissions);
    return guard.canActivate({switchToHttp:()=>({getRequest:()=>({path:'/posts/copy/generate',body:{requestKey},
      org:{id:organizationId,createdAt:new Date(),users:[{role:'SUPERADMIN'}]}})}),getHandler:()=>({})} as any);
  };
  const reconcile=async(status:string)=>{
    const repository={model:db} as any;
    const service=new SubscriptionService(subscriptions,{getIntegrationsList:async()=>[],changeActiveCron:jest.fn(),restoreActiveCron:jest.fn()} as any,
      {enforceSingleEnabledOwner:jest.fn(),disableOrEnableNonSuperAdminUsers:jest.fn()} as any,repository);
    const stripe=new StripeService(service,{} as any,{} as any,{} as any);jest.spyOn(stripe,'checkValidCard').mockResolvedValue(true);
    const event={data:{object:{id:`sub_${org}`,customer:`cus_${org}`,status,cancel_at:2000000000,
      metadata:{service:'gitroom',billing:'LAUNCH_V1',period:'MONTHLY',uniqueId:`sub_${org}`},
      items:{data:[{quantity:1,price:{currency:'usd',type:'recurring',unit_amount:900,recurring:{interval:'month',interval_count:1},
        billing_scheme:'per_unit',lookup_key:'everywhereposter_launch_v1_monthly',metadata:{plan_version:'LAUNCH_V1'}}}]}}}} as any;
    mockSubscriptions.mockResolvedValue({data:[event.data.object],has_more:false});
    if(status==='canceled') await stripe.deleteSubscription(event);else await stripe.updateSubscription(event);
    return subscriptions.getSubscriptionByOrganizationId(org);
  };
  const stages=async function*(m:CopyGenerationModelService){
    yield 'start';await m.summarizeTranscript('Handwritten labels and two stock checks.');
    const brief:any={platform:{name:'LinkedIn',targetCharacters:300,hashtags:'none',lineBreaks:'moderate',ctaStyle:'none'},strategy:{coreMessage:'Check details'},source:{facts:['Handwritten labels']}};
    const draft=await m.generatePlatformDraft(brief,'Write grounded copy','Be specific');
    yield await m.rewriteDraft({brief,draft:draft.draft,reasons:['Specificity'],targetCharacters:300,hardCap:3000});
  };
  const multiPlatformCopy=()=>{
    const source={build:async()=>({media:{id:'fixture-media',mediaType:'image'},
      source:{mediaType:'image',facts:['Handwritten labels'],unknowns:[]},coreMessage:'Check details',sourceConfidence:0.8,
      warnings:[],storedKnowledgeBaseFacts:[],overlapReferenceTexts:[],blocked:false})};
    // Make rewrite selection deterministic while keeping the real generator,
    // prepaid context, model adapter and PostgreSQL wallet in the test path.
    const quality={buildPromptConstraints:()=> 'Fixture constraints',scoreDraft:()=>({score:40,reasons:['Fixture rewrite'],unsupportedClaim:false}),
      shouldRewrite:()=>true,shouldWarn:()=>false,detectTranscriptOverlap:()=>({overlaps:false})};
    return new CopyGenerationService(source as any,quality as any,model,undefined,scope);
  };
  const platformReceipt=(req:any)=>{
    const stage=req.response_format.json_schema.name==='rewriteDraft'?'rewrite':'draft';
    const platform=stage==='draft'?req.messages[1].content.match(/Write one (\w+) draft\./)?.[1]
      :req.messages[0].content.match(/Keep it native to (\w+)\./)?.[1];
    if(!platform) throw Error('Missing platform in fixture request');
    return {platform,stage};
  };
  const configurePlatformReceipts=()=>parse.mockImplementation(async req=>{
    const {platform,stage}=platformReceipt(req);
    return{id:randomUUID(),model:req.model,service_tier:'default',choices:[{finish_reason:'stop',message:{parsed:{draft:`${platform} ${stage} about handwritten labels.`}}}],
      usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,prompt_tokens_details:{cached_tokens:2},completion_tokens_details:{reasoning_tokens:1}}};
  });
  const failSettlementOnce=(stage:string)=>{
    const finish=wallet.finishText.bind(wallet);let interrupted=false;
    return jest.spyOn(wallet,'finishText').mockImplementation(async(organizationId,id)=>{
      const row=await db.aiWalletReservation.findUniqueOrThrow({where:{id}});
      if(!interrupted&&row.operationKey.endsWith(`:${stage}`)){interrupted=true;throw Error('local settlement interruption');}
      return finish(organizationId,id);
    });
  };
  const restartText=()=>{wallet=new AiWalletService({model:db} as any);
    scope=new PrepaidCopyContextService(subscriptions,wallet,new AiWalletTextService(wallet));model=new CopyGenerationModelService(scope);};
  const startedPlatforms=(events:any[])=>events.filter(e=>e.name==='platform-started').map(e=>e.data.platform);
  const walletState=()=>db.aiWallet.findUniqueOrThrow({where:{organizationId:org}});

  it('stops after a paid draft settlement failure and resumes each platform/rewrite identity once',async()=>{
    body.platforms=['linkedin','threads'];configurePlatformReceipts();
    const interrupt=failSettlementOnce('draft_0');
    const failed=await collect(multiPlatformCopy().generate(org,body));
    expect(failed.at(-1)).toMatchObject({name:'completed',data:{requestId:body.requestKey,status:'failed',results:[]}});
    expect(startedPlatforms(failed)).toEqual(['linkedin']);expect(parse).toHaveBeenCalledTimes(1);
    expect(await db.aiWalletReservation.count({where:{organizationId:org}})).toBe(1);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(0);
    interrupt.mockRestore();restartText();
    const complete=(await collect(multiPlatformCopy().generate(org,body))).at(-1);
    expect(complete.data).toMatchObject({requestId:body.requestKey,status:'complete'});
    expect(complete.data.results.map((r:any)=>r.draft)).toEqual(['linkedin rewrite about handwritten labels.','threads rewrite about handwritten labels.']);
    expect(parse.mock.calls.map(([req])=>platformReceipt(req))).toEqual([
      {platform:'linkedin',stage:'draft'},{platform:'linkedin',stage:'rewrite'},{platform:'threads',stage:'draft'},{platform:'threads',stage:'rewrite'}]);
    const rows=await db.aiWalletReservation.findMany({where:{organizationId:org},orderBy:{operationKey:'asc'}});
    expect(rows.map(r=>r.operationKey)).toEqual(['draft_0','draft_1','rewrite_0','rewrite_1'].map(s=>`guided-text:${body.requestKey}:${s}`));
    expect(rows.every(r=>r.state==='SETTLED')).toBe(true);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(4);
    expect(await walletState()).toMatchObject({balanceNanos:99999840n,heldNanos:0n});
    expect((await collect(multiPlatformCopy().generate(org,body))).at(-1)).toEqual(complete);
    expect(parse).toHaveBeenCalledTimes(4);expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(4);
    expect(await walletState()).toMatchObject({balanceNanos:99999840n,heldNanos:0n});
  });
  it('retains earlier partial results and stops later platforms after a paid rewrite settlement failure',async()=>{
    body.platforms=['linkedin','threads','facebook'];configurePlatformReceipts();
    const interrupt=failSettlementOnce('rewrite_1');
    const partial=await collect(multiPlatformCopy().generate(org,body));
    expect(partial.at(-1).data).toMatchObject({requestId:body.requestKey,status:'partial'});
    expect(partial.at(-1).data.results.map((r:any)=>r.platform)).toEqual(['linkedin']);
    expect(startedPlatforms(partial)).toEqual(['linkedin','threads']);expect(parse).toHaveBeenCalledTimes(4);
    expect(await db.aiWalletReservation.count({where:{organizationId:org}})).toBe(4);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(3);
    interrupt.mockRestore();restartText();
    const complete=(await collect(multiPlatformCopy().generate(org,body))).at(-1);
    expect(complete.data).toMatchObject({requestId:body.requestKey,status:'complete'});
    expect(complete.data.results.map((r:any)=>r.draft)).toEqual(body.platforms.map((p:string)=>`${p} rewrite about handwritten labels.`));
    expect(parse).toHaveBeenCalledTimes(6);expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(6);
    expect(await db.aiWalletReservation.count({where:{organizationId:org,state:'SETTLED'}})).toBe(6);
    expect(await walletState()).toMatchObject({balanceNanos:99999760n,heldNanos:0n});
    expect((await collect(multiPlatformCopy().generate(org,body))).at(-1)).toEqual(complete);
    expect(parse).toHaveBeenCalledTimes(6);expect(await walletState()).toMatchObject({balanceNanos:99999760n,heldNanos:0n});
  });
  it('stops paid adaptation on an uncertain provider response without fallback or a later-platform debit',async()=>{
    Object.assign(body,{platforms:['linkedin','threads'],captionMode:'adapt-by-platform',sourceCaption:'Handwritten labels.'});
    configurePlatformReceipts();parse.mockRejectedValueOnce(Error('ambiguous provider outcome'));
    for(let i=0;i<2;i++){
      const failed=await collect(multiPlatformCopy().generate(org,body));
      expect(failed.at(-1).data).toMatchObject({requestId:body.requestKey,status:'failed',results:[]});
      expect(startedPlatforms(failed)).toEqual(['linkedin']);expect(parse).toHaveBeenCalledTimes(1);
    }
    const rows=await db.aiWalletReservation.findMany({where:{organizationId:org}});
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({operationKey:`guided-text:${body.requestKey}:draft_0`,state:'UNKNOWN',usageSnapshot:null});
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(0);
    expect(await walletState()).toMatchObject({balanceNanos:100000000n,heldNanos:rows[0].ceilingNanos});
  });
  it('continues later legacy platforms, including original-caption fallback, with no prepaid reservations',async()=>{
    await db.subscription.update({where:{organizationId:org},data:{subscriptionTier:'PRO'}});
    Object.assign(body,{platforms:['linkedin','threads'],sourceCaption:'Handwritten labels.'});configurePlatformReceipts();
    for(const mode of ['generate','adapt-by-platform']){
      body.captionMode=mode;parse.mockClear();parse.mockRejectedValueOnce(Error('legacy generation failure'));
      const events=await collect(multiPlatformCopy().generate(org,body));const complete=events.at(-1).data;
      expect(startedPlatforms(events)).toEqual(['linkedin','threads']);expect(complete.requestId).toBe(body.requestKey);
      if(mode==='generate'){
        expect(complete.status).toBe('partial');expect(complete.results.map((r:any)=>r.platform)).toEqual(['threads']);
        expect(parse).toHaveBeenCalledTimes(3);
      }else{
        expect(complete.status).toBe('complete');expect(complete.results[0]).toMatchObject({platform:'linkedin',origin:'original',draft:body.sourceCaption});
        expect(complete.results[1]).toMatchObject({platform:'threads',origin:'adapted'});expect(parse).toHaveBeenCalledTimes(2);
      }
    }
    expect(await db.aiWalletReservation.count({where:{organizationId:org}})).toBe(0);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(0);
    expect(await walletState()).toMatchObject({balanceNanos:100000000n,heldNanos:0n});expect(scope.active).toBe(false);
  });
  it('meters analysis, draft and rewrite with no SDK retry and replays after flags/plan pause',async()=>{
    const first=await collect(scope.scope(org,body,()=>stages(model)));expect(parse).toHaveBeenCalledTimes(3);
    for(const [req,opts] of parse.mock.calls){expect(req).toMatchObject({max_completion_tokens:4096,n:1,service_tier:'default'});expect(opts).toMatchObject({maxRetries:0});}
    process.env.AI_WALLET_ENABLED='false';process.env.AI_WALLET_TEXT_ENABLED='false';await db.subscription.delete({where:{organizationId:org}});
    expect(await collect(scope.scope(org,body,()=>stages(model)))).toEqual(first);expect(parse).toHaveBeenCalledTimes(3);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(3);
  });
  it('isolates concurrent organizations and rejects changed source before a second paid call',async()=>{
    await collect(scope.scope(org,body,()=>stages(model)));
    await expect(collect(scope.scope(org,{...body,audience:'changed'},()=>stages(model)))).rejects.toThrow('different inputs');
    expect(parse).toHaveBeenCalledTimes(3);
    const other=randomUUID();await db.organization.create({data:{id:other,name:'Other org',subscription:{create:{subscriptionTier:'LAUNCH_V1',totalChannels:0,period:'MONTHLY'}}}});await db.aiWallet.create({data:{organizationId:other,balanceNanos:100000000n}});
    await Promise.all([collect(scope.scope(org,body,()=>stages(model))),collect(scope.scope(other,body,()=>stages(model)))]);
    expect(parse).toHaveBeenCalledTimes(6);expect(scope.active).toBe(false);
    for(const organizationId of [org,other]) expect(await db.aiWalletLedger.count({where:{organizationId}})).toBe(3);
  });
  it('blocks default-off/new-free paths and visual/image planning before any provider call',async()=>{
    process.env.AI_WALLET_TEXT_ENABLED='false';await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('disabled');
    process.env.AI_WALLET_TEXT_ENABLED='true';await db.subscription.delete({where:{organizationId:org}});
    await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('unavailable');
    await reconcile('active');
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
  it.each(['unpaid','paused','canceled','incomplete_expired'])('denies fresh and RESERVED guided execution after %s, then restores once',async status=>{
    const interrupted=jest.spyOn(wallet,'dispatch').mockRejectedValueOnce(Error('interrupted before claim'));
    await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('interrupted before claim');interrupted.mockRestore();
    const key=`guided-text:${body.requestKey}:summary_0`;
    expect(await wallet.quotedOperation(org,key)).toMatchObject({state:'RESERVED'});
    expect(await reconcile(status)).toBeNull();
    await expect(guardFor(org,body.requestKey)).resolves.toBe(true);
    await expect(guardFor(org,randomUUID())).rejects.toThrow();
    await expect(guardFor(randomUUID(),body.requestKey)).rejects.toThrow();
    await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('disabled');
    await expect(collect(scope.scope(org,{...body,requestKey:randomUUID()},()=>stages(model)))).rejects.toThrow('unavailable');
    expect(parse).not.toHaveBeenCalled();expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(0);
    await reconcile('active');await Promise.allSettled([collect(scope.scope(org,body,()=>stages(model))),collect(scope.scope(org,body,()=>stages(model)))]);
    await collect(scope.scope(org,body,()=>stages(model)));expect(parse).toHaveBeenCalledTimes(3);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(3);
    expect(await db.aiWallet.findUnique({where:{organizationId:org}})).toMatchObject({heldNanos:0n,balanceNanos:99999880n});
  });
  it.each(['active','trialing','past_due'])('preserves %s guided stages and period-end cancellation',async status=>{
    expect(await reconcile(status)).toMatchObject({subscriptionTier:'LAUNCH_V1',cancelAt:new Date(2000000000000)});
    await collect(scope.scope(org,body,()=>stages(model)));await collect(scope.scope(org,body,()=>stages(model)));
    expect(parse).toHaveBeenCalledTimes(3);expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(3);
  });
  it.each(['unpaid','paused','canceled','incomplete_expired'])('rechecks %s between summary and draft in an open iterator',async status=>{
    const iterator=scope.scope(org,body,async function*(){await model.summarizeTranscript('Handwritten labels.');yield 'summary';await model.generatePlatformDraft({platform:{name:'LinkedIn',targetCharacters:300,hashtags:'none',lineBreaks:'moderate',ctaStyle:'none'}} as any,'Grounded copy','Be specific');});
    expect(await iterator.next()).toMatchObject({value:'summary'});expect(scope.active).toBe(false);await reconcile(status);
    await expect(iterator.next()).rejects.toThrow('disabled');expect(scope.active).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(1);
  });
  it('settles a staged summary after restart/revocation without running a new draft or debiting twice',async()=>{
    jest.spyOn(wallet,'finishText').mockRejectedValueOnce(Error('local settlement interruption'));
    await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('settlement interruption');await reconcile('unpaid');
    process.env.BILLING_ENABLED=process.env.AI_WALLET_ENABLED=process.env.AI_WALLET_TEXT_ENABLED='false';
    wallet=new AiWalletService({model:db} as any);scope=new PrepaidCopyContextService(subscriptions,wallet,new AiWalletTextService(wallet));model=new CopyGenerationModelService(scope);
    for(let i=0;i<2;i++) await expect(collect(scope.scope(org,body,()=>stages(model)))).rejects.toThrow('disabled');
    expect(parse).toHaveBeenCalledTimes(1);expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(1);
    Object.assign(process.env,{BILLING_ENABLED:'true',AI_WALLET_ENABLED:'true',AI_WALLET_TEXT_ENABLED:'true'});await reconcile('active');
    await collect(scope.scope(org,body,()=>stages(model)));expect(parse).toHaveBeenCalledTimes(3);
    expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(3);
  });
  it('scopes generator cleanup without leaking context into its consumer',async()=>{
    const cleanup=jest.fn();const iterator=scope.scope(org,body,async function*(){try{yield scope.active;}finally{cleanup(scope.active);}});
    expect(await iterator.next()).toMatchObject({value:true});expect(scope.active).toBe(false);
    await iterator.return(undefined);expect(cleanup).toHaveBeenCalledWith(true);expect(scope.active).toBe(false);expect(parse).not.toHaveBeenCalled();
  });
  it.each(['source','platform'].flatMap(stage=>['settlement','unknown'].map(failure=>[stage,failure])))('retains browser identity after %s %s ambiguity instead of completing caption fallback',async(stage,failure)=>{
    if(failure==='settlement') jest.spyOn(wallet,'finishText').mockRejectedValueOnce(Error('local settlement interruption'));
    else parse.mockRejectedValueOnce(Error('ambiguous provider outcome'));
    const source={assertMediaAccess:async()=>({id:'fixture-media'}),build:async()=>{
      if(stage==='source') await model.summarizeTranscript('Handwritten labels and two stock checks.');
      return{media:{id:'fixture-media',mediaType:'image'},source:{mediaType:'image',visualSummary:'Supplied notes',facts:['Handwritten labels','Two stock checks'],unknowns:[]},
        coreMessage:'Check details',sourceConfidence:0.8,warnings:[],storedKnowledgeBaseFacts:[],overlapReferenceTexts:[],blocked:false};
    }};
    const service=new CopyGenerationService(source as any,new AntiGenericService(),model,undefined,scope);
    const saved=Object.fromEntries(['window','localStorage','crypto'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
    const storage=new Map<string,string>();const keys:string[]=[];
    try{
      Object.defineProperties(globalThis,{window:{configurable:true,value:{}},crypto:{configurable:true,value:webcrypto},
        localStorage:{configurable:true,value:{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}}});
      const fetch=async(_url:string,init:any)=>{
        const request=JSON.parse(init.body);keys.push(request.requestKey);const events=[];
        await guardFor(org,request.requestKey);
        try{for await(const event of service.generate(org,request)) events.push(event);}
        catch{events.push({name:'completed',data:{status:'failed',results:[],imagePlans:[]}});}
        let done=false;return{ok:true,body:{getReader:()=>({read:async()=>done?{done:true}:(done=true,{done:false,
          value:new TextEncoder().encode(events.map(e=>JSON.stringify(e)).join('\n')+'\n')})})}} as any;
      };
      const request:any={mediaId:'fixture-media',platforms:['linkedin'],goal:'position',captionMode:'adapt-by-platform',sourceCaption:'Handwritten labels and two stock checks.'};
      expect((await requestMediaCopyGeneration(fetch,request)).status).toBe('failed');expect(storage.size).toBe(1);
      expect(parse).toHaveBeenCalledTimes(1);expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(0);
      if(failure==='settlement') await reconcile('unpaid');
      expect((await requestMediaCopyGeneration(fetch,request)).status).toBe(failure==='settlement'&&stage==='platform'?'complete':'failed');
      expect(keys[1]).toBe(keys[0]);expect(parse).toHaveBeenCalledTimes(1);
      expect(await db.aiWalletReservation.count({where:{organizationId:org}})).toBe(1);
      expect(await db.aiWalletLedger.count({where:{organizationId:org}})).toBe(failure==='settlement'?1:0);
      if(failure==='unknown'||stage==='source') expect(storage.size).toBe(1);
    }finally{for(const [k,descriptor] of Object.entries(saved)) descriptor?Object.defineProperty(globalThis,k,descriptor):delete(globalThis as any)[k];}
  });
});
