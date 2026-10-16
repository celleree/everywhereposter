import { BillingController } from '../../apps/backend/src/api/routes/billing.controller';
it('requires an organization billing administrator and passes only trusted org/user identity',async()=>{
  const service={request:jest.fn(async()=>({status:'REQUESTED'})),summary:jest.fn(),reviewQueue:jest.fn()};
  const controller=new BillingController({} as any,{} as any,{} as any,{} as any,{} as any,service as any);
  expect(()=>controller.requestWalletRefund({id:'org',users:[{role:'USER'}]} as any,{id:'user'} as any,{operationKey:'synthetic-request-key'})).toThrow('administrator');
  expect(service.request).not.toHaveBeenCalled();
  await controller.requestWalletRefund({id:'trusted-org',users:[{role:'ADMIN'}]} as any,{id:'trusted-user'} as any,{operationKey:'synthetic-request-key'});
  expect(service.request).toHaveBeenCalledWith('trusted-org','trusted-user','synthetic-request-key');
  controller.walletRefundRequests({id:'trusted-org'} as any);expect(service.summary).toHaveBeenCalledWith('trusted-org');
  expect(()=>controller.walletRefundReview({isSuperAdmin:false} as any)).toThrow('Platform administrator');
  controller.walletRefundReview({isSuperAdmin:true} as any);expect(service.reviewQueue).toHaveBeenCalledTimes(1);
});
