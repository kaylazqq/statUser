import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

const bounds = [0.001,0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10,15,30,60,120];
const routes = new Map([
 ['GET /index.html','page_html'],['POST /colink/page/login/start','login_start'],
 ['POST /colink/page/login/complete','login_complete'],['POST /colink/page/authorize/start','authorize_start'],
 ['POST /colink/page/authorize/complete','authorize_complete'],['POST /colink/page/logout','app_logout'],
 ['GET /api/v1/topic-stats','statistics'],['POST /api/v1/topic-stats','statistics'],
]);
export function createTelemetry({enabled=false,issuer,fetcher=fetch,now=()=>performance.now()}={}) {
 const context=new AsyncLocalStorage(), active=new Map(), values=new Map();
 let sequence=0,dropped=0;
 function begin(phase) {
  if(!enabled)return()=>{};
  if(active.size>=4096){dropped++;return()=>{};}
  const id=++sequence,at=now();active.set(id,{phase,at});let ended=false;
  return outcome=>{
   if(ended)return;ended=true;active.delete(id);
   const seconds=Math.max(0,now()-at)/1000,key=phase+':'+outcome;
   let row=values.get(key);if(!row){row={phase,outcome,count:0,sum:0,buckets:bounds.map(()=>0)};values.set(key,row);}
   row.count++;row.sum+=seconds;bounds.forEach((b,i)=>{if(seconds<=b)row.buckets[i]++;});
  };
 }
 const observe=(req,res)=>{
  if(!enabled)return undefined;
  let phase;try {phase=routes.get(req.method+' '+new URL(req.url,'http://localhost').pathname);}catch{return undefined;}
  if(!phase)return undefined;
  const end=begin(phase);
  const finish=()=>{end(!res.writableFinished?'cancelled':res.statusCode>=200&&res.statusCode<300?'success':'error');res.off('finish',finish);res.off('close',finish);};
  res.once('finish',finish);res.once('close',finish);
  return phase;
 };
 return {observe,run:(phase,fn)=>context.run(phase,fn),
  async fetcher(input,options){
   let phase;
   try{
    const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(u.origin===issuer){
     const kind=u.pathname.endsWith('/oauth/token')?'token':u.pathname.endsWith('/extensions/session-validations')?'session_validate':u.pathname.endsWith('/oauth/jwks')?'jwks':/\/extensions\/user-executions\/[^/]+$/.test(u.pathname)?'execution_read':null;
     if(kind){const parent=context.getStore();phase='sdk_'+(parent==='login_complete'?'login':parent==='authorize_complete'?'authorize':parent==='statistics'?'statistics':'background')+'_'+kind+'_headers';}
    }
   }catch{}
   const end=phase?begin(phase):()=>{};
   try {const response=await fetcher(input,options);end(response.ok?'success':'error');return response;}
   catch(error){end(error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?'cancelled':'error');throw error;}
  },
  render(){
   const lines=['# App HTTP stages include full local response. SDK *_headers ends at upstream headers, not body/verification.'];
   for(const row of values.values()){
    const labels=`phase="${row.phase}",outcome="${row.outcome}"`;
    lines.push(`echo_stats_stage_seconds_count{${labels}} ${row.count}`,`echo_stats_stage_seconds_sum{${labels}} ${row.sum}`);
    bounds.forEach((b,i)=>lines.push(`echo_stats_stage_seconds_bucket{${labels},le="${b}"} ${row.buckets[i]}`));
    lines.push(`echo_stats_stage_seconds_bucket{${labels},le="+Inf"} ${row.count}`);
   }
   const current=new Map();
   for(const {phase,at} of active.values()){const v=current.get(phase)||{count:0,oldest:0};v.count++;v.oldest=Math.max(v.oldest,(now()-at)/1000);current.set(phase,v);}
   // Keep zero gauges for previously known phases so completion is observable.
   const phases=new Set([...values.values()].map(x=>x.phase));for(const p of current.keys())phases.add(p);
   for(const phase of phases){const v=current.get(phase)||{count:0,oldest:0};lines.push(`echo_stats_stage_inflight{phase="${phase}"} ${v.count}`,`echo_stats_stage_oldest_seconds{phase="${phase}"} ${v.oldest}`);}
   lines.push(`echo_stats_telemetry_dropped_total ${dropped}`);return lines.join('\n')+'\n';
  }
 };
}
