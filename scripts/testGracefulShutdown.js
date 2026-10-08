const assert = require('node:assert/strict');
const http = require('node:http');
const {EventEmitter}=require('node:events');
const {installGracefulShutdown}=require('../src/http/gracefulShutdown');
(async()=>{
 const processLike=new EventEmitter();const exits=[];processLike.exit=code=>exits.push(code);
 let exited;const done=new Promise(resolve=>exited=resolve);processLike.exit=code=>{exits.push(code);exited();};
 let started;const received=new Promise(resolve=>started=resolve);
 const server=http.createServer((req,res)=>{started();setTimeout(()=>res.end('complete'),80);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 installGracefulShutdown(server,{processLike,deadlineMs:1000,logger:{log(){},error(){}}});
 const response=new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${server.address().port}`,res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve(body));}).on('error',reject));
 await received;processLike.emit('SIGTERM');processLike.emit('SIGTERM');
 assert.equal(await response,'complete','An accepted request survives deployment termination');
 await done;assert.deepEqual(exits,[0],'Shutdown is idempotent and completes after draining');
 console.log('Graceful termination drains a real in-flight HTTP request and handles repeated signals.');
})().catch(error=>{console.error(error);process.exitCode=1;});
