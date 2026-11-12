function workerObservation(parent, operation, origin) {
  const inactive = { events: [], end: () => {
  } };
  try {
    if (!/^[a-f0-9]{32}$/.test(parent?.traceId) || !/[1-9a-f]/.test(parent.traceId) || !/^[a-f0-9]{16}$/.test(parent?.spanId) || !/[1-9a-f]/.test(parent.spanId)) return inactive;
    const started = performance.now(), spanId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    const offset = Number.isFinite(origin) ? Math.max(0, started - origin) : 0;
    const base = { version: 1, runtime: "worker", operation, traceId: parent.traceId, spanId, parentSpanId: parent.spanId };
    const events = [{ ...base, outcome: "started", elapsedMs: offset, metrics: [] }];
    let ended = false;
    return { events, startedAt: started, end(outcome = "success", error, bytes, memory, count) {
      if (ended) return;
      ended = true;
      try {
        const duration = Math.max(0, performance.now() - started), metrics = [{ name: "duration_ms", value: duration }];
        if (Number.isSafeInteger(bytes) && bytes >= 0) metrics.push({ name: "bytes", value: bytes });
        if (Number.isSafeInteger(memory) && memory >= 0) metrics.push({ name: "memory_bytes", value: memory });
        if (Number.isSafeInteger(count) && count >= 0) metrics.push({ name: "count", value: count });
        events.push({ ...base, outcome, elapsedMs: offset + duration, metrics, ...error ? { error } : {} });
      } catch {
      }
    } };
  } catch {
    return inactive;
  }
}
function workerObserver(parent, emit, origin) {
  try {
    if (!Number.isFinite(origin)) origin = performance.now();
  } catch {
  }
  let sent = 0, dropped = 0, closed = false;
  const send = (events) => {
    if (!events.length) return;
    if (closed || sent + events.length > 128) {
      dropped += events.length;
      return;
    }
    sent += events.length;
    try {
      emit(events.slice());
    } catch {
      dropped += events.length;
    }
  };
  const begin = (operation) => {
    if (closed) return { context: null, end() {
    } };
    const span = workerObservation(parent, operation, origin);
    send(span.events);
    let ended = false;
    return { context: span.events.length ? parent : null, end(outcome = "success", error, metrics = []) {
      if (ended || closed) return;
      ended = true;
      let bytes, memory, count;
      try {
        bytes = metrics.find((m) => m.name === "bytes")?.value;
        memory = metrics.find((m) => m.name === "memory_bytes")?.value;
        count = metrics.find((m) => m.name === "count")?.value;
      } catch {
      }
      span.end(outcome, error, bytes, memory, count);
      send(span.events.slice(1));
    } };
  };
  const timing = (start, end, bytes, status) => {
    if (closed || !Number.isFinite(start) || !Number.isFinite(end) || start < origin || end < start || end > performance.now() + 1) return;
    const span = workerObservation(parent, "runtime_transfer", origin);
    if (!span.events.length) return;
    const failure = Number.isInteger(status) && status >= 400 && status <= 599;
    span.end(failure ? "failure" : Number.isInteger(status) && status >= 200 && status < 400 ? "success" : "observed", failure ? "network" : void 0, bytes);
    if (span.events.length !== 2) return;
    span.events[0].elapsedMs = start - origin;
    span.events[1].elapsedMs = end - origin;
    span.events[1].metrics[0].value = end - start;
    send(span.events);
  };
  return { begin, timing, finish() {
    if (closed) return;
    closed = true;
    if (dropped) {
      const report = workerObservation(parent, "telemetry_drop", origin);
      report.end("success", void 0, void 0, void 0, dropped);
      try {
        if (report.events.length) emit(report.events);
      } catch {
      }
    }
  } };
}
// Shared by browser modules and the classic service worker. Only public compiler
// data lives here; project databases and credentials never enter this adapter.
globalThis.createScribyraDownloads = function(policy,observer){
 const trace=(operation,parent,local=observer)=>{try{return local?.(operation,parent)||{context:null,end(){}};}catch{return{context:null,end(){}};}};
 const fail=(span,error)=>{let name;try{name=error?.name;}catch{}span.end(name==='AbortError'?'cancelled':'failure',name==='AbortError'?undefined:name==='TimeoutError'?'timeout':name==='QuotaExceededError'?'quota':'network');};
 const CHUNK=256*1024,CHECKPOINT=1024*1024,DB='scribyra-tex-packages';
 const RUNTIME_CACHE='scribyra-runtime-verified-v1';
 let database;
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 function validSettings(value){return value&&Object.keys(value).length===Object.keys(policy.defaults).length&&Object.keys(policy.defaults).every(key=>key==='version'?value[key]===1:Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=policy.maximum[key]&&value[key]%policy.mib===0);}
 function header(id,value){return{id,kind:value.kind==='metadata'?'metadata':'archive',size:value.bytes?.byteLength||0,used:value.used||0,package:value.package||null,path:value.path||null};}
 function db(){return database||=(new Promise((resolve,reject)=>{
  const open=indexedDB.open(DB,2);let failed=false;
  open.onblocked=()=>{failed=true;reject(new Error('Close older Scribyra tabs to upgrade the public compiler cache. Project files are unaffected.'));};
  open.onerror=()=>reject(open.error);
  open.onupgradeneeded=()=>{
   if(failed){open.transaction.abort();return;}
   const result=open.result;if(!result.objectStoreNames.contains('archives'))result.createObjectStore('archives');
   for(const name of ['headers','control','partials','chunks'])if(!result.objectStoreNames.contains(name))result.createObjectStore(name);
   const source=open.transaction.objectStore('archives'),index=open.transaction.objectStore('headers'),cursor=source.openCursor();
   cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;index.put(header(row.key,row.value),row.key);row.continue();};
  };
  open.onsuccess=()=>{if(failed){open.result.close();return;}open.result.onversionchange=()=>{open.result.close();database=null;};resolve(open.result);};
 })).catch(error=>{database=null;throw error;});}
 async function transaction(stores,mode,work){
  const tx=(await db()).transaction(stores,mode),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new DOMException('Cache transaction aborted','AbortError'));});done.catch(()=>{});
  try{const result=await work(tx,request);await done;return result;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
 }
 async function limitsIn(tx){const value=await request(tx.objectStore('control').get('limits'));return validSettings(value)?value:{...policy.defaults};}
 const settings=()=>transaction(['control'],'readonly',limitsIn);
 async function safeSettings(){try{return await settings();}catch{return{version:1,archiveBytes:0,metadataBytes:0,runtimeBytes:0,partialBytes:0};}}
 async function drop(tx,row){await request(tx.objectStore('partials').delete(row.id));await request(tx.objectStore('chunks').delete(IDBKeyRange.bound([row.id,0],[row.id,Number.MAX_SAFE_INTEGER])));}
 async function clearPartials(kind){return transaction(['partials','chunks'],'readwrite',async tx=>{for(const row of await request(tx.objectStore('partials').getAll()))if(!kind||row.kind===kind)await drop(tx,row);});}
 async function partials(){return transaction(['partials'],'readonly',async tx=>(await request(tx.objectStore('partials').getAll())).map(({owner,until,...row})=>row));}
 function assetId(asset){
  const length=asset.algorithm==='SHA-256'?64:asset.algorithm==='SHA-512'?128:0,max=asset.kind==='archive'?32*policy.mib:asset.kind==='metadata'?2*policy.mib:asset.kind==='runtime'?512*policy.mib:0;
  if(!length||!new RegExp(`^[a-f0-9]{${length}}$`).test(asset.hash)||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>max)throw new Error('Invalid pinned download size or checksum.');
  return`${asset.algorithm}:${asset.hash}:${asset.size}`;
 }
 const digest=async(algorithm,bytes)=>[...new Uint8Array(await crypto.subtle.digest(algorithm,bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 async function reserve(asset,id,owner,force){
  return transaction(['partials','chunks','control'],'readwrite',async tx=>{
   const limit=(await limitsIn(tx)).partialBytes;if(!limit)return null;const store=tx.objectStore('partials');let row=await request(store.get(id));const now=Date.now();
   if(row&&row.owner&&row.until>now&&row.until<=now+30000&&!force)return null;
   const rows=await request(store.getAll()),retained=[];
   for(const old of rows){if(now-old.used>7*86400000){await drop(tx,old);if(old.id===id)row=null;}else if(old.id!==id)retained.push(old);}
   retained.sort((a,b)=>a.used-b.used||a.id.localeCompare(b.id));while(retained.length>=256)await drop(tx,retained.shift());
   if(row&&!(row.size===asset.size&&row.kind===asset.kind&&Number.isSafeInteger(row.length)&&row.length>=0&&row.length<=asset.size&&Number.isSafeInteger(row.count)&&row.count>=0&&row.count<=2048)){await drop(tx,row);row=null;}
   row=row||{id,kind:asset.kind,label:String(asset.label||asset.kind).slice(0,256),size:asset.size,length:0,count:0};
   row={...row,owner,until:now+30000,used:now};await request(store.put(row,id));return row;
  });
 }
 async function forget(id,owner){return transaction(['partials','chunks'],'readwrite',async tx=>{const row=await request(tx.objectStore('partials').get(id));if(row&&(!owner||row.owner===owner))await drop(tx,row);});}
 async function release(id,owner){return transaction(['partials','chunks'],'readwrite',async tx=>{const store=tx.objectStore('partials'),row=await request(store.get(id));if(row?.owner===owner){if(!row.length)await drop(tx,row);else await request(store.put({...row,owner:null,until:0},id));}});}
 async function checkpoint(asset,id,owner,bytes,from,to){
  if(to<=from)return true;const pieces=[];
  for(let at=from;at<to;at+=CHUNK){const content=bytes.slice(at,Math.min(to,at+CHUNK));pieces.push({bytes:content,sha256:await digest('SHA-256',content)});}
  return transaction(['partials','chunks','control'],'readwrite',async tx=>{
   const limit=(await limitsIn(tx)).partialBytes,store=tx.objectStore('partials'),row=await request(store.get(id));
   if(!row||row.owner!==owner||row.length!==from||to>limit||!limit)return false;
   const old=(await request(store.getAll())).filter(item=>item.id!==id).sort((a,b)=>a.used-b.used);let total=old.reduce((sum,item)=>sum+item.length,0)+to;
   for(const item of old){if(total<=limit)break;await drop(tx,item);total-=item.length;}
   for(let i=0;i<pieces.length;i++)await request(tx.objectStore('chunks').put(pieces[i],[id,row.count+i]));
   await request(store.put({...row,length:to,count:row.count+pieces.length,used:Date.now(),until:Date.now()+30000},id));return true;
  });
 }
 async function prefix(row,bytes){
  let at=0;
  for(let i=0;i<row.count;i++){
   const piece=await transaction(['chunks'],'readonly',tx=>request(tx.objectStore('chunks').get([row.id,i])));
   if(!(piece?.bytes instanceof Uint8Array)||!piece.bytes.length||piece.bytes.length>CHUNK||at+piece.bytes.length>row.length||await digest('SHA-256',piece.bytes)!==piece.sha256)throw new Error('Interrupted download data is corrupt.');
   bytes.set(piece.bytes,at);at+=piece.bytes.length;
  }
  if(at!==row.length)throw new Error('Interrupted download is incomplete.');return at;
 }
 async function transfer(asset,options,force){
  const id=assetId(asset),owner=crypto.randomUUID(),signal=options.signal||new AbortController().signal,fetcher=options.fetcher||globalThis.fetch;
  signal.throwIfAborted();let row;try{row=await reserve(asset,id,owner,force);}catch{row=null;}
  let bytes=new Uint8Array(asset.size),offset=0,saved=0,persist=!!row;
  if(row){try{offset=await prefix(row,bytes);saved=offset;}catch{await forget(id,owner).catch(()=>{});row=await reserve(asset,id,owner,force).catch(()=>null);persist=!!row;}}
  if(offset){const cached=trace('cache',options.telemetryParent,options.observe);cached.end('success',undefined,[{name:'bytes',value:offset},{name:'count',value:1}]);}
  const progress=()=>options.onProgress?.(offset,asset.size,{resumedBytes:initial,savedBytes:saved});let initial=offset,fullRetry=false;
  if(offset)progress();
  const network=new AbortController(),abortNetwork=()=>network.abort(signal.reason),idleTimeout=options.idleTimeoutMs??30000;
  signal.addEventListener('abort',abortNetwork,{once:true});if(signal.aborted)abortNetwork();
  // Bound each wait for headers/bytes, independently of the compilation timer.
  function wait(promise){return new Promise((resolve,reject)=>{
   let done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);network.signal.removeEventListener('abort',aborted);error?reject(error):resolve(value);},aborted=()=>finish(network.signal.reason),timer=setTimeout(()=>network.abort(Object.assign(new Error('No download progress for 30 seconds. Retry to resume the download.'),{name:'TimeoutError'})),idleTimeout);
   network.signal.addEventListener('abort',aborted,{once:true});if(network.signal.aborted)aborted();promise.then(value=>finish(null,value),error=>finish(error));
  });}
  try{
   for(let attempt=0;attempt<2;attempt++){
    if(attempt){const retry=trace('retry',options.telemetryParent,options.observe);retry.end('success',undefined,[{name:'count',value:1}]);}
    let reader;
    try{
     if(offset<asset.size){
      const headers=new Headers(options.headers);if(offset&&!fullRetry)headers.set('Range',`bytes=${offset}-`);else headers.delete('Range');
      let response;
      try{response=await wait(fetcher(options.url,{signal:network.signal,credentials:options.credentials||'omit',referrerPolicy:'no-referrer',cache:'no-store',headers}));}
      catch(error){if(offset&&!network.signal.aborted&&attempt===0){fullRetry=true;continue;}throw error;}
      if(offset&&response.status===200){await forget(id,owner).catch(()=>{});row=await reserve(asset,id,owner,force).catch(()=>null);persist=!!row;offset=saved=initial=0;}
      else if(offset){
       const match=response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/),encoding=response.headers.get('Content-Encoding');
       if(response.status!==206||!match||Number(match[1])!==offset||Number(match[2])!==asset.size-1||Number(match[3])!==asset.size||encoding&&encoding!=='identity'){
        await response.body?.cancel().catch(()=>{});if(attempt===0){fullRetry=true;continue;}throw new Error('Server returned an invalid byte range.');
       }
      }
      if(!response.ok||response.status!==200&&response.status!==206)throw new Error(`Download is unavailable (HTTP ${response.status}).`);
      if(!offset&&response.status===206)throw new Error('Unexpected partial response.');
      if(!response.body)throw new Error('Download response has no body.');reader=response.body.getReader();
      for(;;){signal.throwIfAborted();const{done,value}=await wait(reader.read());if(done)break;if(offset+value.length>asset.size){await forget(id,owner).catch(()=>{});persist=false;throw new Error('Download changed or exceeds its pinned size.');}bytes.set(value,offset);offset+=value.length;progress();if(persist&&offset-saved>=CHECKPOINT){persist=await checkpoint(asset,id,owner,bytes,saved,offset).catch(()=>false);if(persist)saved=offset;}}
      if(offset!==asset.size)throw new Error('Download was interrupted before its pinned size.');
     }
     const verification=trace('verify',options.telemetryParent,options.observe);let valid;
     try{valid=await digest(asset.algorithm,bytes)===asset.hash;verification.end(valid?'success':'failure',valid?undefined:'integrity',[{name:'bytes',value:bytes.byteLength}]);}catch(error){fail(verification,error);throw error;}
     if(!valid){await forget(id,owner).catch(()=>{});persist=false;if(initial&&attempt===0){offset=saved=initial=0;row=await reserve(asset,id,owner,force).catch(()=>null);persist=!!row;continue;}throw Object.assign(new Error('Download checksum differs from the pinned compiler snapshot.'),{name:'IntegrityError'});}
     signal.throwIfAborted();await forget(id,owner).catch(()=>{});return bytes;
    }catch(error){reader?.cancel().catch(()=>{});if(persist&&offset>saved)await checkpoint(asset,id,owner,bytes,saved,offset).catch(()=>{});throw error;}
   }
   throw new Error('Download could not be resumed.');
  }finally{signal.removeEventListener('abort',abortNetwork);network.abort();await release(id,owner).catch(()=>{});}
 }
 async function fetchBytes(asset,options){
  const span=trace('download',options.telemetryParent,options.observe);
  try{const id=assetId(asset),scoped={...options,telemetryParent:span.context};
   const bytes=await(globalThis.navigator?.locks?navigator.locks.request('scribyra-download:'+id,{ifAvailable:true},lock=>transfer(asset,scoped,!!lock)):transfer(asset,scoped,false));
   span.end('success',undefined,[{name:'bytes',value:bytes.byteLength}]);return bytes;
  }catch(error){if(error?.name==='IntegrityError')span.end('failure','integrity');else fail(span,error);throw error;}
 }
 async function runtimeInventory(){
  const cache=await caches.open(RUNTIME_CACHE),items=[];
  for(const key of await cache.keys()){const response=await cache.match(key),size=Number(response?.headers.get('Content-Length'));if(!Number.isSafeInteger(size)||size<=0){await cache.delete(key);continue;}let touched;try{touched=await transaction(['control'],'readonly',tx=>request(tx.objectStore('control').get('runtime:'+new URL(key.url).pathname.split('/').pop())));}catch{}items.push({key,size,used:touched?.used||Number(response.headers.get('X-Scribyra-Cached-At'))||0,path:response.headers.get('X-Scribyra-Asset')||'Compiler asset'});}return{cache,items};
 }
 async function pruneRuntime(localObserver){
  const limit=(await safeSettings()).runtimeBytes,{cache,items}=await runtimeInventory();let total=items.reduce((sum,item)=>sum+item.size,0);
  let span,count=0,bytes=0;
  try{for(const item of items.sort((a,b)=>a.used-b.used||a.key.url.localeCompare(b.key.url))){if(total<=limit)break;span||=trace('cache_evict',undefined,localObserver);const removed=await cache.delete(item.key);if(removed){count++;bytes+=item.size;}total-=item.size;}span?.end('success',undefined,[{name:'count',value:count},{name:'bytes',value:bytes}]);}
  catch(error){span?.end('failure',error?.name==='QuotaExceededError'?'quota':'unknown',[{name:'count',value:count},{name:'bytes',value:bytes}]);throw error;}
  return{bytes:total,count:(await cache.keys()).length,limit};
 }
 async function saveRuntime(key,response,asset,localObserver){
  if(asset.size>(await safeSettings()).runtimeBytes)return false;
  const headers=new Headers(response.headers);headers.set('X-Scribyra-Cached-At',String(Date.now()));headers.set('X-Scribyra-Asset',asset.path);
  const cache=await caches.open(RUNTIME_CACHE);await cache.put(key,new Response(response.body,{headers}));await touchRuntime(asset).catch(()=>{});await pruneRuntime(localObserver);return!!await cache.match(key);
 }
 async function touchRuntime(asset){return transaction(['control'],'readwrite',tx=>request(tx.objectStore('control').put({used:Date.now()},'runtime:'+asset.sha256)));}
 async function clearLegacyRuntime(){
  // Older releases used two unbounded compiler caches. Keep source/app stores
  // separate, and report an open old preload connection instead of claiming it
  // was removed. The pinned Biber wrapper no longer writes compiler data here.
  await caches.delete('scribyra-tex-v1.4.1');
  return new Promise(resolve=>{const deletion=indexedDB.deleteDatabase('EM_PRELOAD_CACHE');deletion.onsuccess=()=>resolve(true);deletion.onerror=deletion.onblocked=()=>resolve(false);});
 }
 async function trimPartials(){return transaction(['partials','chunks','control'],'readwrite',async tx=>{const limit=(await limitsIn(tx)).partialBytes,rows=(await request(tx.objectStore('partials').getAll())).sort((a,b)=>a.used-b.used);let total=rows.reduce((sum,row)=>sum+row.length,0);for(const row of rows)if(total>limit||!limit){await drop(tx,row);total-=row.length;}});}
 return{db,request,transaction,limitsIn,settings,validSettings,policy,header,fetchBytes,partials,clearPartials,forgetPartial:id=>forget(id),trimPartials,pruneRuntime,saveRuntime,touchRuntime,runtimeInventory,clearLegacyRuntime,RUNTIME_CACHE};
};

const downloads=globalThis.createScribyraDownloads({"defaults":{"version":1,"archiveBytes":134217728,"metadataBytes":33554432,"runtimeBytes":268435456,"partialBytes":134217728},"maximum":{"version":1,"archiveBytes":2147483648,"metadataBytes":268435456,"runtimeBytes":2147483648,"partialBytes":536870912},"mib":1048576}
);
const CACHE='scribyra-shell-313202af404c';
const PRECACHE=["/app/","/app/index.html","/app/agent.md","/app/assets/pdf.worker.min-CHFwMXne.mjs","/app/assets/cursor-editorTextHighlight-kG3uUOwL.svg","/app/assets/scribyra_app_bg-DuGCC315.wasm","/app/assets/index-BMq0chqG.css","/app/assets/comments-BlMehZhV.css","/app/assets/index-mrFyl4MF.js","/app/assets/index-B4mo8Wq-.js","/app/assets/workspace-worker-DB-w41Jr.js","/app/assets/tex-packages-worker-BZ_T7Qsg.js"];
const SHELL="/app/";
const ENGINE='scribyra-tex-v1.4.1';
const VERIFIED='scribyra-runtime-verified-v1';
const BASE="/app/core/busytex";
const RUNTIME=[{"path":"busytex_worker.js","size":10380,"sha256":"de981f550ab5c003406f1c59bf5b012d3e3bd364b4da5535b1a313d7d3a09fce"},{"path":"busytex_pipeline.js","size":42535,"sha256":"99c68ca0f3ddc5831381e4ba9a6a4907410bf89c4eca1895cb2ebd3f4827b1cd"},{"path":"busytex_biber.js","size":5098,"sha256":"da831cf81753cc9beedee33ba91a8278865691f88fd8ec9ebbb2184007990116"},{"path":"busytex.js","size":271327,"sha256":"366ede08b0394a65b2936d29016953905182d38c4484940cc3afcf2f326c0ac9"},{"path":"busytex.wasm","size":32507525,"sha256":"8d1988fc58cd1611c3cbd6bd986c3e607e5ff44f1d94252207ff7aae4cee72e0"},{"path":"texlive-lualatex.16c5e279ee29593c2f09455e82a3bdc701651d52472631ebce5bffc7d086c2d3.js","size":941021,"sha256":"16c5e279ee29593c2f09455e82a3bdc701651d52472631ebce5bffc7d086c2d3"},{"path":"texlive-lualatex.9c92ea102944673398013eec0d0370803f497f6e44667c5c3539ca87ddf597a6.data","size":45641875,"sha256":"9c92ea102944673398013eec0d0370803f497f6e44667c5c3539ca87ddf597a6"},{"path":"biber.js","size":1069013,"sha256":"f1ae86a6f284c6601c9bc78582cd5e162f0e63edd4b1dd18dfbc90def7d8e743"},{"path":"biber.wasm","size":9644474,"sha256":"6c2ddccf3b95e06b419d4aee5f88ef10ddec658ce760fabb34d7145371ff18c5"},{"path":"biber.data","size":21079910,"sha256":"9ea1357e6180477479b5edfe17538ba655ebebc03142a195d85fb1d47899df21"}];
const operations=new Map();
const observers=new Map();
function closeObserver(id){const entry=observers.get(id);if(!entry)return;observers.delete(id);entry.stream.finish();try{entry.port.postMessage({done:true});entry.port.close();}catch{}}
function observerFor(event,id){const entry=observers.get(id);if(!entry)return;if(entry.until<Date.now()){closeObserver(id);return;}if(entry.clientId!==event.clientId)return;entry.until=Date.now()+1800000;return entry.stream.begin;}
function validContext(value){return typeof value?.traceId==='string'&&/^[a-f0-9]{32}$/.test(value.traceId)&&/[1-9a-f]/.test(value.traceId)&&typeof value?.spanId==='string'&&/^[a-f0-9]{16}$/.test(value.spanId)&&/[1-9a-f]/.test(value.spanId);}
function scope(event,emit){const value=event.data?.context;if(event.origin!==self.location.origin||typeof event.source?.id!=='string'||!validContext(value))return;return workerObserver({traceId:value.traceId,spanId:value.spanId},emit);}
function localSpan(observer,operation){try{return observer?.(operation)||{end(){}};}catch{return{end(){}};}}
function failedSpan(span,error){let name;try{name=error?.name;}catch{}span.end(name==='AbortError'?'cancelled':'failure',name==='AbortError'?undefined:name==='QuotaExceededError'?'quota':name==='IntegrityError'?'integrity':'unknown');}
const assets=new Map(RUNTIME.map(asset=>[`${BASE}/${asset.path}`,asset]));
const key=asset=>new Request(new URL(`/__scribyra-runtime/${asset.sha256}`,self.location.origin));
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
function runtimeBytes(bytes,asset,original){const headers=new Headers(original);headers.delete('Content-Encoding');headers.delete('Vary');headers.set('Content-Length',String(bytes.length));headers.set('Content-Type',asset.path.endsWith('.wasm')?'application/wasm':asset.path.endsWith('.js')?'application/javascript':asset.path.endsWith('.json')?'application/json':'application/octet-stream');return new Response(bytes,{headers});}
// No skipWaiting here: a new worker waits until a tab's Reload asks it to take over
// (see handOver in update-notice.js), or until every tab of the app has closed. The
// very first install has nothing to wait for and claims the open tab on activate.
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{try{await downloads.clearLegacyRuntime();}catch{}await self.clients.claim();})());});
async function verified(response,asset,progress,observer){
 const span=localSpan(observer,'verify');
 try{
 if(!response?.ok)throw new Error(`Compiler asset ${asset.path} is unavailable.`);
 const bytes=new Uint8Array(asset.size),reader=response.body.getReader();let offset=0,last=0;
 try{for(;;){const{done,value}=await reader.read();if(done)break;if(offset+value.length>bytes.length)throw Object.assign(new Error(`Compiler asset ${asset.path} exceeds its manifest size.`),{name:'IntegrityError'});bytes.set(value,offset);offset+=value.length;const now=Date.now();if(progress&&(now-last>100||offset===bytes.length)){last=now;progress(offset);}}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 if(offset!==asset.size||await digest(bytes)!==asset.sha256)throw Object.assign(new Error(`Compiler asset ${asset.path} failed checksum verification.`),{name:'IntegrityError'});
 span.end('success',undefined,[{name:'bytes',value:bytes.byteLength}]);return runtimeBytes(bytes,asset,response.headers);
 }catch(error){failedSpan(span,error);throw error;}
}
async function runtimeResponse(event,asset){
 let cache;try{cache=await caches.open(VERIFIED);}catch{}const request=event.request,id=request.headers.get('X-Scribyra-Prepare'),client=id&&event.clientId?await self.clients.get(event.clientId):null;
 const observer=observerFor(event,id);
 const progress=(loaded,network=false)=>client?.postMessage({type:'scribyra-runtime-progress',id,path:asset.path,loaded,total:asset.size,network});
 const lookup=localSpan(observer,'cache');let cached;try{cached=cache&&await cache.match(key(asset));lookup.end('success',undefined,[{name:'count',value:cached?1:0}]);}catch(error){failedSpan(lookup,error);throw error;}
 if(cached){try{const response=await verified(cached,asset,progress,observer);await downloads.touchRuntime(asset).catch(()=>{});return response;}catch{const removed=await cache?.delete(key(asset));if(removed)localSpan(observer,'cache_evict').end('success',undefined,[{name:'count',value:1},{name:'bytes',value:asset.size}]);}}
 // Reuse older compiler caches only after verifying their exact content.
 for(const name of [ENGINE,CACHE]){let prior;try{prior=await(await caches.open(name)).match(request,{ignoreVary:true});}catch{}if(prior){try{const response=await verified(prior,asset,progress,observer);const saved=localSpan(observer,'cache');try{const ok=await downloads.saveRuntime(key(asset),response.clone(),asset,observer);saved.end(ok?'success':'failure',ok?undefined:'unavailable');}catch(error){failedSpan(saved,error);}return response;}catch{}}}
 const abort=new AbortController(),cancel=()=>abort.abort();request.signal?.addEventListener('abort',cancel,{once:true});if(request.signal?.aborted)cancel();if(id)operations.set(id,{abort});
 try{const headers=new Headers(request.headers);headers.delete('X-Scribyra-Prepare');
 const bytes=await downloads.fetchBytes({kind:'runtime',label:asset.path,size:asset.size,hash:asset.sha256,algorithm:'SHA-256'},{url:request.url,headers,signal:abort.signal,credentials:'same-origin',onProgress:loaded=>progress(loaded,true),observe:observer});
 const response=runtimeBytes(bytes,asset),saved=localSpan(observer,'cache');try{const ok=await downloads.saveRuntime(key(asset),response.clone(),asset,observer);saved.end(ok?'success':'failure',ok?undefined:'unavailable',[{name:'bytes',value:bytes.byteLength}]);}catch(error){failedSpan(saved,error);}return response;}
 catch(error){return new Response(error.message||String(error),{status:502,headers:{'Content-Type':'text/plain','X-Scribyra-Runtime-Error':'1'}});}
 finally{request.signal?.removeEventListener('abort',cancel);if(id&&operations.get(id)?.abort===abort)operations.delete(id);}
}
self.addEventListener('message',event=>{
 if(event.data?.type==='scribyra-skip-waiting'){if(event.origin===self.location.origin)self.skipWaiting();return;}
 if(event.data?.type==='scribyra-runtime-observe'){
  const port=event.ports?.[0],id=event.data.id;if(!port)return;
  for(const[key,entry]of observers)if(entry.until<Date.now())closeObserver(key);
  const stream=scope(event,telemetry=>port.postMessage({telemetry}));
  if(!stream||typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)||observers.has(id)||observers.size>=32){port.postMessage({ready:false});port.close();return;}
  observers.set(id,{stream,port,clientId:event.source.id,until:Date.now()+1800000});port.postMessage({ready:true});return;
 }
 if(event.data?.type==='scribyra-runtime-unobserve'){const entry=observers.get(event.data.id);if(entry&&event.origin===self.location.origin&&entry.clientId===event.source?.id)closeObserver(event.data.id);return;}
 // The initiating client supplies an unguessable UUID capability. Navigation
 // can replace its Client id or clear event.source before this message arrives.
 if(event.data?.type==='scribyra-runtime-cancel'){const operation=operations.get(event.data.id);if(operation&&event.origin===self.location.origin)operation.abort.abort();return;}
 const port=event.ports?.[0];if(!port||!['scribyra-runtime-status','scribyra-runtime-clear'].includes(event.data?.type))return;
 const stream=scope(event,telemetry=>port.postMessage({telemetry})),observer=stream?.begin;
 event.waitUntil((async()=>{try{
  if(event.data.type==='scribyra-runtime-clear'){const cleared=localSpan(observer,'cache_evict');try{await caches.delete(VERIFIED);await caches.delete(ENGINE);await downloads.clearPartials('runtime');cleared.end();}catch(error){failedSpan(cleared,error);throw error;}stream?.finish();port.postMessage({ok:true});return;}
  await downloads.pruneRuntime(observer);const cache=await caches.open(VERIFIED),entries=[];
  for(const asset of RUNTIME){let valid=false;const response=await cache.match(key(asset));if(response){try{await verified(response,asset,undefined,observer);valid=true;}catch{await cache.delete(key(asset));}}entries.push({path:asset.path,size:asset.size,valid});}
  stream?.finish();
  port.postMessage({ok:true,ready:entries.every(asset=>asset.valid),entries});
 }catch(error){stream?.finish();port.postMessage({ok:false,error:error.message||String(error)});}})());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/rooms/'))return;
 const asset=assets.get(url.pathname);if(asset){event.respondWith(runtimeResponse(event,asset));return;}
 // Optional package archives use the Rust-verified IndexedDB cache exclusively.
 if(url.pathname.startsWith(`${BASE}/components/`)||url.pathname.startsWith(`${BASE}/metadata/`)||/\/tex-catalog\.[a-f0-9]{64}\.json$/.test(url.pathname))return;
 // Old tabs may still request the original large data bundle or unknown assets.
 // Only manifest-pinned compiler assets belong in the bounded runtime cache.
 if(url.pathname.startsWith(`${BASE}/`))return;
 const cacheable=PRECACHE.includes(url.pathname)||url.pathname.startsWith(`${SHELL}assets/`)||request.mode==='navigate';if(!cacheable)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),cached=await cache.match(request,{ignoreVary:true});
  if(cached&&(request.mode!=='navigate'||url.pathname===`${SHELL}agent.md`)&&request.cache!=='reload')return cached;
  try{const response=await fetch(request);if(response.ok){try{await cache.put(request,response.clone());}catch{}}return response;}
  catch(error){if(cached)return cached;if(request.mode==='navigate'&&url.pathname!==`${SHELL}agent.md`)return(await cache.match(SHELL))||Response.error();throw error;}
 })());
});
