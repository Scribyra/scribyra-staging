// BEGIN SCRIBYRA BIBER PROJECT
function scribyraBiberProject(FS,workDir,controlPath,files){
 const root=workDir.replace(/\/$/,'')+'/project',seen=new Set();let total=0;
 const path=value=>{
  if(typeof value!=='string'||value.length>1024||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..')||/[\\:\x00-\x1f\x7f]/.test(value))throw new Error('Unsafe Biber project input path.');
  return root+'/'+value;
 };
 const control=path(controlPath);
 if(files.length>10000)throw new Error('Too many Biber input files.');
 const prepared=files.map(({path:name,contents})=>{
  const target=path(name),bytes=typeof contents==='string'?new TextEncoder().encode(contents):contents;
  if(seen.has(target)||!(bytes instanceof Uint8Array)||bytes.length>32*1024*1024||(total+=bytes.length)>128*1024*1024)throw new Error('Biber input files are duplicate, invalid or exceed their memory budget.');
  seen.add(target);return{target,bytes};
 });
 if(!seen.has(control))throw new Error('Biber control file is missing.');
 for(const{target,bytes}of prepared){FS.mkdirTree(target.slice(0,target.lastIndexOf('/')));FS.writeFile(target,bytes);}
 FS.chdir(control.slice(0,control.lastIndexOf('/')));
 return{controlFile:controlPath.slice(controlPath.lastIndexOf('/')+1),outputFile:control.replace(/\.bcf$/i,'.bbl')};
}
// END SCRIBYRA BIBER PROJECT
// Loader for the standalone biber wasm module, which cannot share busytex's
// main() and is loaded lazily on the first .bcf run. The perl tree is preloaded
// into the module's own filesystem at link time.

class BusytexBiber {
    constructor(biber_js, biber_wasm, biber_data, print, script_loader, scribyra_observe = null) {
        this.scribyraObserve = scribyra_observe;
        this.biber_js = biber_js;
        this.biber_wasm = biber_wasm;
        this.biber_data = biber_data;
        this.print = print;
        this.script_loader = script_loader;
        this.work_dir = '/home/web_user/biber';
        this.bin_biber = '/opt/perl-wasm/bin/biber';
        this.assets_promise = null;
        this.last_output = '';
    }

    _assets() {
        if (this.assets_promise == null) {
            this.assets_promise = Promise.all([
                this.script_loader(this.biber_js),
                fetch(this.biber_wasm).then(response => {
                    if (!response.ok) throw new Error(`Failed to fetch WASM module: ${this.biber_wasm} (HTTP ${response.status})`);
                    return response.arrayBuffer().then(WebAssembly.compile);
                }),
            ]);
        }
        return this.assets_promise;
    }

    // perl tears down its interpreter on exit, so every run gets a fresh
    // instance; the compiled wasm is reused and the data package comes from the
    // preload cache emscripten maintains.
    async instantiate() {
        const [, wasm_module] = await this._assets();

        const Module = {
            noInitialRun: true,
            scribyraObserve: this.scribyraObserve,
            locateFile: path => path.endsWith('.wasm') ? this.biber_wasm : path.endsWith('.data') ? this.biber_data : path,
            instantiateWasm(imports, successCallback) {
                WebAssembly.instantiate(wasm_module, imports).then(successCallback).catch(err => { throw new Error('Error while initializing biber!\n\n' + err.toString()) });
                return {};
            },
            print: text => { this.last_output += text + '\n'; this.print(text); },
            printErr: text => { this.last_output += text + '\n'; this.print(text); },
        };

        const moduleFactory = typeof biber !== 'undefined' ? biber : self.biber;
        if (!moduleFactory) throw new Error('No biber module factory found. Ensure biber.js is loaded.');
        return await moduleFactory(Module);
    }

    // Data sources are resolved relative to the control file, so everything is
    // written into one directory. Returns the .bbl text, or null on failure.
    async run(bcf_path, files, verbose_args = []) {
        this.last_output = '';
        const Module = await this.instantiate();
        const FS = Module.FS;
        const basename = p => p.slice(p.lastIndexOf('/') + 1);

        const staged=scribyraBiberProject(FS,this.work_dir,bcf_path,files);
        const bcf=staged.controlFile;
        const bbl = bcf.replace(/\.bcf$/, '.bbl');
        const argv = [this.bin_biber, '--output-format=bbl', `--outfile=${bbl}`, '--nolog', '--output-safechars', ...verbose_args, bcf];

        const cmdline = '$ biber ' + argv.slice(1).join(' ');
        this.last_output += cmdline + '\n';
        this.print(cmdline);

        let exit_code = 0;
        try {
            exit_code = Module.callMain(argv);
        } catch (err) {
            exit_code = typeof err.status == 'number' ? err.status : 1;
        }

        if (exit_code != 0)
            return null;

        const bbl_full = staged.outputFile;
        return FS.analyzePath(bbl_full).exists ? FS.readFile(bbl_full, { encoding: 'utf8' }) : null;
    }
}

if (typeof self !== 'undefined') self.BusytexBiber = BusytexBiber;
