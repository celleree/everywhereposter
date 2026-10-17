// Explicit local fixture: real JWT/middleware/policies/controller/service, synthetic repositories.
// Imported only by the owned browser adapter, never the application runtime.
module.exports=function cookedAuth(repository,probe,frontend){
  if(process.env.EP_COOKED_BROWSER!=='1'||frontend!=='http://127.0.0.1:4547'||!/^\/tmp\/ep-cooked-ui\.[\w]+\/ipc\/cooked\.sock$/.test(process.env.COOKED_EDITOR_SOCKET||''))throw new Error('Owned cooked fixture configuration required');
  Object.assign(process.env,{JWT_SECRET:'isolated-cooked-browser-signing-key-not-production',COOKED_EDITOR_ENABLED:'true',COOKED_EDITOR_ORGANIZATIONS:'synthetic-org'});
  const {AuthService}=require('../../libraries/helpers/src/auth/auth.service.ts');
  const {AuthMiddleware}=require('../../apps/backend/src/services/auth/auth.middleware.ts');
  const {PoliciesGuard}=require('../../apps/backend/src/services/auth/permissions/permissions.guard.ts');
  const {PermissionsService}=require('../../apps/backend/src/services/auth/permissions/permissions.service.ts');
  const {Reflector}=require('@nestjs/core');
  const {CookedReviewService}=require('../../libraries/nestjs-libraries/src/media-editing/cooked-review.service.ts');
  const {CookedReviewController}=require('../../apps/backend/src/api/routes/cooked-review.controller.ts');
  const service=new CookedReviewService(repository,probe),controller=new CookedReviewController(service);
  const user=id=>({id,activated:true,isSuperAdmin:false});
  const token=AuthService.signJWT(user('synthetic-user')),otherToken=AuthService.signJWT(user('other-user'));
  const organizations={getOrgsByUserId:async id=>[{id:id==='synthetic-user'?'synthetic-org':'other-org',name:'Owned browser fixture',apiKey:'fixture-only',createdAt:new Date(),users:[{userId:id,role:'ADMIN',disabled:false}]}]};
  const middleware=new AuthMiddleware(organizations,{});
  const guard=new PoliciesGuard(new Reflector(),new PermissionsService({},{},{},{}));
  const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  const body=async req=>{let text='';for await(const b of req){text+=b;if(text.length>16384)throw Object.assign(new Error('Fixture body limit'),{status:413})}return /^application\/json(?:;|$)/i.test(String(req.headers['content-type']||''))?JSON.parse(text||'{}'):undefined};
  return {token,async handle(req,res,url){
    if(url.pathname==='/__cooked/session'&&req.method==='GET'){json(res,{token,otherToken});return true}
    if(!url.pathname.startsWith('/media/cooked/'))return false;
    try{
      req.cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=' )).filter(x=>x.length===2));req.path=url.pathname;
      let authenticated=false;await middleware.use(req,res,()=>{authenticated=true});if(!authenticated)throw Object.assign(new Error('Authentication failed'),{status:403});
      const parts=url.pathname.split('/').filter(Boolean).slice(2),id=parts[0],job=parts[1],view=parts[2];
      let action;
      if(id==='status'&&req.method==='GET')action='status';
      else if(job==='find'&&req.method==='GET')action='find';
      else if(parts.length===1&&req.method==='POST')action='create';
      else if(job==='request'&&parts.length===3&&req.method==='DELETE')action='remove';
      else if(parts.length===3&&req.method==='POST'&&['edits','output'].includes(view))action=view==='edits'?'edit':'output';
      else if(parts.length===3&&req.method==='GET')action='view';
      if(!action){json(res,{},404);return true}
      await guard.canActivate({getHandler:()=>controller[action],switchToHttp:()=>({getRequest:()=>req})});
      let result;
      if(action==='status')result=await controller.status(req.org);
      else if(action==='find')result=await controller.find(req.org,id,url.searchParams.get('request'));
      else if(action==='create')result=await controller.create(req.org,id,req,await body(req));
      else if(action==='edit')result=await controller.edit(req.org,id,job,req,await body(req));
      else if(action==='output')result=await controller.output(req.org,id,job,req,await body(req));
      else if(action==='remove')result=await controller.remove(req.org,id,view,req);
      else{
        res.status=s=>{res.statusCode=s;return res};res.type=t=>{res.setHeader('content-type',t==='html'?'text/html; charset=utf-8':t==='json'?'application/json':t);return res};res.send=b=>res.end(b);
        await controller.view(req.org,id,job,view,url.searchParams.get('k'),req,res);return true;
      }
      json(res,result);return true;
    }catch(e){if(!res.headersSent)json(res,{message:'Owned editor fixture request rejected'},e.getStatus?.()||e.status||500);else res.destroy();return true}
  }};
};
