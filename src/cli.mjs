import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { updateFile, checkFile } from './index.mjs';

export async function runCLI(args,{root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),fetchImpl=fetch,log=console.log}={}) {
  const [command,...flags]=args;
  if(!['update','check'].includes(command)||flags.length>1||flags.some(flag=>flag!=='--online')||command==='update'&&flags.length)throw new Error('Usage: npm run update | npm run check [-- --online]');
  const config=JSON.parse(await fs.readFile(path.join(root,'plugins.json'),'utf8'));const options={config,indexFile:path.join(root,'index.json'),fetchImpl};
  if(command==='update'){const result=await updateFile(options);log(result.changed?'index.json updated from reviewed pins':'index.json unchanged');return result;}
  const result=await checkFile({...options,online:flags.includes('--online')});log('index.json valid'+(result.online?' (online freshness verified)':' (offline)'));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){runCLI(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});}
