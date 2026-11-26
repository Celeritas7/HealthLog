// Exercises the actual current sync module with fictional records and a fake
// Supabase transport. These tests never initialize Auth or contact a service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const source = await readFile(new URL('../healthlog-sync.js',import.meta.url),'utf8');
const a='70000000-0000-4000-8000-000000000001',b='70000000-0000-4000-8000-000000000002';
const allowed=new Set(['healthlog_visits','healthlog_medicines','healthlog_dose_logs','healthlog_conflicts','healthlog_settings']);
const clone=x=>structuredClone(x);
async function harness(uid) {
 const store=new Map([['unrelated-offline-pack','retain'],['healthlog-log-v1','retained symptom cache']]);
 globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const rows={
  healthlog_visits:[{id:'visit-a',local_id:'local-a',user_id:a,visit_date:'2026-01-01',clinic_name:'Fictional A',notes:'A 日本語',concern:'fixture',cost_consult:12.34},
   {id:'visit-b',local_id:'local-b',user_id:b,visit_date:'2026-01-02',clinic_name:'Fictional B',notes:'Keep B',concern:'fixture',cost_consult:56.78}],
  healthlog_medicines:[{id:'med-a',user_id:a,visit_id:'visit-a',name:'Fixture A',dose:'test only',slots:['morning'],days:1,sort:0},
   {id:'med-b',user_id:b,visit_id:'visit-b',name:'Fixture B',dose:'',slots:['night'],days:1,sort:0}],
  healthlog_dose_logs:[{user_id:a,medicine_id:'med-a',log_date:'2026-01-01',slot:'morning',taken:true}],
  healthlog_conflicts:[],healthlog_settings:[]
 };
 const calls=[];let next=0;
 const sb={auth:{getSession:async()=>({data:{session:{user:{id:uid}}}})},from(table){
  assert(allowed.has(table),'Unexpected table '+table);
  const q={table,mode:'select',filters:[],payload:null,conflict:null,one:false};
  const chain={
   select(){return chain},eq(k,v){q.filters.push([k,v]);return chain},order(){return chain},
   single(){q.one=true;return chain},maybeSingle(){q.one=true;return chain},
   upsert(v,o){q.mode='upsert';q.payload=clone(v);q.conflict=o.onConflict.split(',');return chain},
   insert(v){q.mode='insert';q.payload=clone(v);return chain},
   update(v){q.mode='update';q.payload=clone(v);return chain},delete(){q.mode='delete';return chain},
   then(resolve,reject){return Promise.resolve().then(()=>{
    calls.push(clone(q));
    let result=rows[table].filter(r=>r.user_id===uid&&q.filters.every(([k,v])=>r[k]===v));
    if(q.mode==='upsert'||q.mode==='insert') {
     result=[];
     for(const value of Array.isArray(q.payload)?q.payload:[q.payload]){
      assert.equal(value.user_id,uid);
      const found=q.mode==='upsert'&&rows[table].find(r=>r.user_id===uid&&q.conflict.every(k=>r[k]===value[k]));
      if(found){Object.assign(found,value);result.push(found);}
      else {const row={id:'synthetic-'+(++next),...value};rows[table].push(row);result.push(row);}
     }
    } else if(q.mode==='update') result.forEach(r=>Object.assign(r,q.payload));
    else if(q.mode==='delete') rows[table]=rows[table].filter(r=>!result.includes(r));
    return {data:clone(q.one?(result[0]??null):result),error:null};
   }).then(resolve,reject)}
  };return chain;
 }};
 // Inject only the test transport; leave the production module on disk unchanged.
 const mod=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport function bindSyntheticTransport(x){sb=x;}\n// '+uid).toString('base64'));
 mod.bindSyntheticTransport(sb);
 return {mod,rows,calls,store};
}

test('desktop, mobile, prototypes and shared scripts do not consume the old archive tables',async()=>{
 const paths=[...(await readdir(new URL('../',import.meta.url))).filter(p=>/\.(html|js)$/.test(p)),
  ...(await readdir(new URL('../Temp/',import.meta.url))).filter(p=>p.endsWith('.html')).map(p=>'Temp/'+p)];
 for(const path of paths) assert.doesNotMatch(await readFile(new URL('../'+path,import.meta.url),'utf8'),/healthlog_(?:visits|clinics|medicines|dose_logs)_old/i,path);
 for(const file of ['HealthLog Desktop v2.dc.html','HealthLog Mobile v2.dc.html']) {
  const s=await readFile(new URL('../'+file,import.meta.url),'utf8');
  assert.match(s,/import\('\.\/healthlog-sync\.js'\)/);
  assert.match(s,/this\.S\.syncNow/);
 }
});

for(const uid of [a,b]) test('current sync keeps visit, medicine and settings contracts for synthetic '+(uid===a?'A':'B'),async()=>{
 const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{throw Error('Hosted network calls forbidden in this test')};
 try{
  const {mod,rows,calls,store}=await harness(uid),other=uid===a?b:a;
  const before=Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,clone(v.filter(r=>r.user_id===other))]));
  const pulled=await mod.pull();assert.equal(pulled.visits.length,1);assert.equal(pulled.uid,uid);
  const note=pulled.visits[0].notes,med=pulled.visits[0].meds[0].name;
  const result=await mod.syncNow({visits:pulled.visits,taken:pulled.taken});assert.equal(result.ok,true);
  assert.equal(result.visits[0].notes,note);assert.equal(result.visits[0].meds[0].name,med);
  assert.equal(result.visits[0].costs.consult,uid===a?12.34:56.78);
  if(uid===a) assert.equal(result.taken['2026-01-01']['local-a-0-morning'],true);
  assert.equal((await mod.saveSettings({theme:'dark',currency:'JPY',budget:100})).ok,true);
  assert.deepEqual(await mod.getSettings(),{theme:'dark',currency:'JPY',budget:100});
  assert.equal((await mod.syncNow(result)).ok,true);
  assert.equal(rows.healthlog_visits.filter(r=>r.user_id===uid).length,1);
  assert.equal(rows.healthlog_medicines.filter(r=>r.user_id===uid).length,1);
  for(const [k,v] of Object.entries(before))assert.deepEqual(rows[k].filter(r=>r.user_id===other),v);
  assert(calls.every(c=>allowed.has(c.table)));
  assert.equal(store.get('unrelated-offline-pack'),'retain');
  assert.equal(store.get('healthlog-log-v1'),'retained symptom cache');
 }finally{globalThis.fetch=fetchBefore;delete globalThis.localStorage;}
});
