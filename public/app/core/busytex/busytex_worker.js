// BEGIN SCRIBYRA WORKER OBSERVATION
function workerObservation(parent,operation,origin){
 const inactive={events:[],end:()=>{}};
 try{
  if(!/^[a-f0-9]{32}$/.test(parent?.traceId)||!/[1-9a-f]/.test(parent.traceId)
    ||!/^[a-f0-9]{16}$/.test(parent?.spanId)||!/[1-9a-f]/.test(parent.spanId))return inactive;
  const started=performance.now(),spanId=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');
  const offset=Number.isFinite(origin)?Math.max(0,started-origin):0;
  const base={version:1,runtime:'worker',operation,traceId:parent.traceId,spanId,parentSpanId:parent.spanId};
  const events=[{...base,outcome:'started',elapsedMs:offset,metrics:[]}];let ended=false;
  return{events,startedAt:started,end(outcome='success',error,bytes,memory,count){
   if(ended)return;ended=true;
   try{const duration=Math.max(0,performance.now()-started),metrics=[{name:'duration_ms',value:duration}];
    if(Number.isSafeInteger(bytes)&&bytes>=0)metrics.push({name:'bytes',value:bytes});
    if(Number.isSafeInteger(memory)&&memory>=0)metrics.push({name:'memory_bytes',value:memory});
    if(Number.isSafeInteger(count)&&count>=0)metrics.push({name:'count',value:count});
    events.push({...base,outcome,elapsedMs:offset+duration,metrics,...(error?{error}:{})});
   }catch{}
  }};
 }catch{return inactive;}
}
function workerObserver(parent,emit,origin){
 try{if(!Number.isFinite(origin))origin=performance.now();}catch{}
 let sent=0,dropped=0,closed=false;
 const send=events=>{if(!events.length)return;if(closed||sent+events.length>128){dropped+=events.length;return;}sent+=events.length;try{emit(events.slice());}catch{dropped+=events.length;}};
 const begin=operation=>{
  if(closed)return{context:null,end(){}};
  const span=workerObservation(parent,operation,origin);send(span.events);let ended=false;
  return{context:span.events.length?parent:null,end(outcome='success',error,metrics=[]){
   if(ended||closed)return;ended=true;let bytes,memory,count;
   try{bytes=metrics.find(m=>m.name==='bytes')?.value;memory=metrics.find(m=>m.name==='memory_bytes')?.value;count=metrics.find(m=>m.name==='count')?.value;}catch{}
   span.end(outcome,error,bytes,memory,count);send(span.events.slice(1));
  }};
 };
 // Resource Timing supplies completed intervals, without observing network bodies.
 const timing=(start,end,bytes,status)=>{
  if(closed||!Number.isFinite(start)||!Number.isFinite(end)||start<origin||end<start||end>performance.now()+1)return;
  const span=workerObservation(parent,'runtime_transfer',origin);if(!span.events.length)return;
  const failure=Number.isInteger(status)&&status>=400&&status<=599;
  span.end(failure?'failure':Number.isInteger(status)&&status>=200&&status<400?'success':'observed',failure?'network':undefined,bytes);
  if(span.events.length!==2)return;
  span.events[0].elapsedMs=start-origin;span.events[1].elapsedMs=end-origin;
  span.events[1].metrics[0].value=end-start;send(span.events);
 };
 return{begin,timing,finish(){if(closed)return;closed=true;if(dropped){const report=workerObservation(parent,'telemetry_drop',origin);report.end('success',undefined,undefined,undefined,dropped);try{if(report.events.length)emit(report.events);}catch{}}}};
}
async function workerCompileObservation(pipeline,args,parent){
 const trace=workerObservation(parent,'worker_pass');
 const stream=workerObserver(parent,events=>self.postMessage({scribyraTelemetry:events}),trace.startedAt);
 const resources=workerResourceObservation(stream,trace.startedAt,trace.events.length>0);
 const originalObserver=pipeline.scribyraObserve;pipeline.scribyraObserve=trace.events.length?stream.begin:undefined;
 const originalCommand=pipeline._run_cmd,bibliography=pipeline.biber,originalBiber=bibliography?.run;let command,biber;
 if(trace.events.length)try{
  if(typeof originalCommand==='function')pipeline._run_cmd=command=function(...args){
   const tool=args[2]?.[0],operation=typeof tool==='string'&&tool.startsWith('bibtex')?'bibliography_pass':typeof tool==='string'&&tool.startsWith('makeindex')?'index_pass':'tex_pass';
   const span=stream.begin(operation);
   try{const result=originalCommand.apply(this,args);try{span.end(result.exit_code===0?'success':'failure',result.exit_code===0?undefined:'source',[{name:'memory_bytes',value:args[0]?.HEAPU8?.byteLength}]);}catch{}return result;}
   catch(error){span.end('failure','worker');throw error;}
  };
  if(typeof originalBiber==='function')bibliography.run=biber=async function(...args){
   const span=stream.begin('bibliography_pass');
   try{const result=await originalBiber.apply(this,args);span.end(result!=null?'success':'failure',result!=null?undefined:'source');return result;}
   catch(error){span.end('failure','worker');throw error;}
  };
 }catch{}
 try{
  const result=await pipeline.compile(...args);let memory;
  if(trace.events.length)try{memory=(await pipeline.Module)?.HEAPU8?.byteLength;}catch{}
  trace.end(result.exit_code===0?'success':'failure',result.exit_code===0?undefined:'source',result.pdf?.byteLength,memory);
  return trace.events.length?{...result,scribyraTelemetry:trace.events}:result;
 }catch(error){trace.end('failure','worker');if(trace.events.length)try{self.postMessage({scribyraTelemetry:trace.events});}catch{}throw error;}
 finally{resources.finish();stream.finish();try{pipeline.scribyraObserve=originalObserver;if(command&&pipeline._run_cmd===command)pipeline._run_cmd=originalCommand;if(biber&&bibliography.run===biber)bibliography.run=originalBiber;}catch{}}
}
function workerResourceObservation(stream,origin,enabled){
 let observer,closed=false;
 const read=entries=>{if(closed)return;try{for(const entry of entries){if(entry.entryType==='resource')stream.timing(entry.startTime,entry.responseEnd,entry.encodedBodySize,entry.responseStatus);}}catch{}};
 if(enabled)try{
  if(!PerformanceObserver.supportedEntryTypes?.includes('resource'))throw new Error('Unavailable resource observer');
  observer=new PerformanceObserver(list=>{try{read(list.getEntries());}catch{}});
  observer.observe({type:'resource',buffered:false});
 }catch{try{observer?.disconnect();}catch{}observer=null;stream.begin('telemetry_delivery').end('failure','unavailable');}
 return{finish(){if(closed)return;try{if(observer)read(observer.takeRecords());}catch{}closed=true;try{observer?.disconnect();}catch{}observer=null;}};
}
function workerInitializeObservation(create,parent){
 // The initialized callback follows asynchronous engine/data initialization.
 // Close and drain before posting readiness so the browser request stays open.
 if(!parent)return create(value=>postMessage({initialized:value}),undefined);
 let origin;try{origin=performance.now();}catch{return create(value=>postMessage({initialized:value}),undefined);}
 const stream=workerObserver(parent,events=>self.postMessage({scribyraTelemetry:events}),origin);
 const resources=workerResourceObservation(stream,origin,true);
 const finish=()=>{resources.finish();stream.finish();};
 try{return create(value=>{finish();postMessage({initialized:value});},stream.begin);}
 catch(error){finish();throw error;}
}
// END SCRIBYRA WORKER OBSERVATION
importScripts('busytex_biber.js');
importScripts('busytex_pipeline.js');

self.pipeline = null;

onmessage = async ({ data: { files, main_tex_path, bibtex, biber, makeindex, rerun, busytex_wasm, busytex_js, biber_js, biber_wasm, biber_data, preload_data_packages_js, data_packages_js, texmf_local, preload, verbose, driver, remote_endpoint, shell_escape, load_shell_handler_script, read_project_files, write_texlive_remote_files, write_texlive_remote_misses, scribyra_telemetry } }) => {
    // TODO: cache data packages from here? https://developer.mozilla.org/en-US/docs/Web/API/Cache

    if (busytex_wasm && busytex_js && preload_data_packages_js) {
        try {
            self.pipeline = workerInitializeObservation((scribyra_ready, scribyra_observe) => new BusytexPipeline(busytex_js, busytex_wasm, data_packages_js, preload_data_packages_js, texmf_local, msg => postMessage({ print: msg }), scribyra_ready, preload, BusytexPipeline.ScriptLoaderWorker, biber_js, biber_wasm, biber_data, scribyra_observe), scribyra_telemetry);
        }
        catch (err) {
            postMessage({ exception: 'Exception during initialization: ' + err.toString() + '\nStack:\n' + err.stack });
        }
    }
    else if (load_shell_handler_script) {
        try {
            importScripts(load_shell_handler_script);
            if (self.handler_ready)
                await self.handler_ready;
            postMessage({ shell_handler_script_loaded: load_shell_handler_script });
        }
        catch (err) {
            postMessage({ exception: 'Exception loading shell handler script: ' + err.toString() + '\nStack:\n' + err.stack });
        }
    }
    else if (read_project_files && self.pipeline) {
        try {
            postMessage({ project_files: await self.pipeline.read_project_files(read_project_files.dir || null) });
        }
        catch (err) {
            postMessage({ exception: 'Exception reading project files: ' + err.toString() + '\nStack:\n' + err.stack });
        }
    }
    else if (write_texlive_remote_files && self.pipeline) {
        try {
            await self.pipeline.write_texlive_remote_files(write_texlive_remote_files);
            postMessage({ texlive_remote_written: true });
        }
        catch (err) {
            postMessage({ exception: 'Exception writing remote files: ' + err.toString() + '\nStack:\n' + err.stack });
        }
    }
    else if (write_texlive_remote_misses && self.pipeline) {
        try {
            await self.pipeline.write_texlive_remote_misses(write_texlive_remote_misses);
            postMessage({ texlive_remote_misses_written: true });
        }
        catch (err) {
            postMessage({ exception: 'Exception writing remote misses: ' + err.toString() + '\nStack:\n' + err.stack });
        }
    }
    else if (files && self.pipeline) {
        try {
            postMessage(await workerCompileObservation(self.pipeline, [files, main_tex_path, bibtex, biber, makeindex, rerun, verbose, driver, data_packages_js, remote_endpoint, shell_escape === true], scribyra_telemetry))
        }
        catch (err) {
            postMessage({ exception: 'Exception during compilation: ' + err.toString() + '\nStack:\n' + err.stack });
        }
    }
};