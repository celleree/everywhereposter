const http=require('node:http');
const r=http.request({socketPath:'/ipc/cooked.sock',path:'/health',timeout:2000},res=>{
 let body='';res.on('data',b=>{body+=b;if(body.length>1024)r.destroy()});
 res.on('end',()=>{try{process.exit(res.statusCode===200&&JSON.parse(body).ready===true?0:1)}catch{process.exit(1)}});
});
r.on('timeout',()=>r.destroy());r.on('error',()=>process.exit(1));r.end();
