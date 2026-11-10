import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTelemetry } from '../src/telemetry.js';
test('counts pending/oldest and finish/close once with fixed phase labels',()=>{
 let now=0;const t=createTelemetry({enabled:true,now:()=>now});const r=Object.assign(new EventEmitter(),{statusCode:200,writableFinished:false});
 t.observe({method:'POST',url:'/colink/page/login/start?secret=never'},r);now=42;
 assert.match(t.render(),/phase="login_start"} 1/);assert.match(t.render(),/0.042/);
 r.writableFinished=true;r.emit('finish');r.emit('close');
 const value=t.render();assert.match(value,/echo_stats_stage_seconds_count\{phase="login_start",outcome="success"} 1/);assert.ok(!value.includes('secret'));assert.equal(r.listenerCount('close'),0);
});
test('SDK headers timing preserves response, errors and input without recording credentials',async()=>{
 const response=new Response('unchanged',{status:200});let input;let options;
 const t=createTelemetry({enabled:true,issuer:'https://host.invalid',fetcher:async(a,b)=>{input=a;options=b;return response;}});
 const args={headers:{Authorization:'Bearer never-record'},body:'client_secret=never-record'};
 assert.equal(await t.run('login_complete',()=>t.fetcher('https://host.invalid/api/v1/oauth/token',args)),response);
 assert.equal(input,'https://host.invalid/api/v1/oauth/token');assert.equal(options,args);assert.equal(await response.text(),'unchanged');
 assert.match(t.render(),/sdk_login_token_headers/);assert.ok(!t.render().includes('never-record'));
 const error=Error('private');const broken=createTelemetry({enabled:true,issuer:'https://host.invalid',fetcher:async()=>{throw error;}});
 await assert.rejects(broken.fetcher('https://host.invalid/api/v1/oauth/token'),e=>e===error);
 assert.match(broken.render(),/outcome="error"/);assert.ok(!broken.render().includes('private'));
});
test('disabled telemetry does not track requests',()=>{
 const t=createTelemetry();const r=Object.assign(new EventEmitter(),{statusCode:200,writableFinished:true});t.observe({method:'GET',url:'/index.html'},r);r.emit('finish');assert.ok(!t.render().includes('echo_stats_stage_seconds_count'));
});
