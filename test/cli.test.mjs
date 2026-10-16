import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCLI } from '../src/cli.mjs';
test('CLI refuses missing/unknown commands and unexpected flags',async()=>{for(const args of [[],['publish'],['check','--bad'],['update','--online']])await assert.rejects(runCLI(args),/usage|argument/i);});
test('CLI updates and checks only the explicit reviewed pins',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-index-cli-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const config=JSON.parse(await fs.readFile(new URL('../plugins.json',import.meta.url),'utf8'));await fs.writeFile(path.join(root,'plugins.json'),JSON.stringify(config));const messages=[];
  const fetchImpl=async url=>{const pin=config.plugins.find(p=>url.endsWith('/'+p.name));return new Response(JSON.stringify({name:pin.name,time:{[pin.version]:'2026-10-16T03:24:55.111Z'},versions:{[pin.version]:{name:pin.name,version:pin.version,dsh:{bundle:{patch:'./cordis.patch.yml'}},engines:{dsh:'^0.2.1-alpha.1'}}}}));};
  const options={root,fetchImpl,log:message=>messages.push(message)};await runCLI(['update'],options);await runCLI(['update'],options);await runCLI(['check'],options);await runCLI(['check','--online'],options);assert.equal(messages.length,4);assert.match(messages[0],/updated/i);assert.match(messages[1],/unchanged/i);assert.match(messages[3],/online/i);assert.equal(JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8')).plugins.length,2);
});
