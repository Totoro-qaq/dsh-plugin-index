import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';

const REGISTRY='https://registry.npmjs.org';
const PACKAGES=['dsh-jot','dsh-plugin-bridge'];
const VALIDATION_URL='https://example.invalid/index.json';
const PLUGIN_FIELDS=['name','version','title','description','author','homepage','repository','metadata'];
const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const serialize=value=>JSON.stringify(value,null,2)+'\n';

function knownFields(value,fields,label) {
  ensure(value!==null&&typeof value==='object'&&!Array.isArray(value),label+' must be an object');
  ensure(Object.keys(value).every(key=>fields.includes(key)),label+' contains an unknown property');
}
function bilingual(value,label) {
  for(const language of ['en','zh'])ensure(typeof value?.[language]==='string'&&value[language].trim()!=='',label+' must include en and zh');
}
function pluginInfo(pin) {
  return Object.fromEntries(Object.entries(pin).filter(([key])=>key!=='version'));
}
function document(config,versions) {
  return {format:1,title:config.title,description:config.description,plugins:config.plugins.map((pin,i)=>({...pluginInfo(pin),versions:[versions[i]]}))};
}
function versionEntry(version,publishTimestamp,dsh) {
  return {version,publishTimestamp,source:{type:'npm',registry:REGISTRY+'/'},engines:{dsh}};
}

export function validatePins(config) {
  knownFields(config,['registry','title','description','plugins'],'pins');
  ensure(config.registry===REGISTRY,'registry must be exactly '+REGISTRY);
  bilingual(config.title,'index title');bilingual(config.description,'index description');
  ensure(Array.isArray(config.plugins)&&config.plugins.length===2,'Exactly the two reviewed plugins are required');
  ensure(new Set(config.plugins.map(pin=>pin?.name)).size===2&&config.plugins.every(pin=>PACKAGES.includes(pin?.name)),'Only the two distinct author-owned plugin names are allowed');
  for(const pin of config.plugins){knownFields(pin,PLUGIN_FIELDS,'plugin');bilingual(pin.title,'plugin title');bilingual(pin.description,'plugin description');}
  // Use the public official grammar for exact SemVer pins and format-1 metadata.
  parseMarketIndex(document(config,config.plugins.map(pin=>versionEntry(pin.version,0,'*'))),VALIDATION_URL);
  return config;
}

export async function fetchPackument(name,{fetchImpl=fetch,timeoutMs=10000,maxBytes=4*1024*1024}={}) {
  ensure(PACKAGES.includes(name),'Only author-owned package names may be fetched');
  ensure(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'Invalid timeout limit');
  ensure(Number.isInteger(maxBytes)&&maxBytes>0&&maxBytes<=16*1024*1024,'Invalid size limit');
  const url=REGISTRY+'/'+name;const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Registry timeout'));},timeoutMs);});
  try {
    return await Promise.race([deadline,(async()=>{
      const response=await fetchImpl(url,{redirect:'error',signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'});
      ensure(response.status===200,'Registry HTTP failure: '+response.status);
      ensure(!response.redirected&&(!response.url||response.url===url),'Registry redirect or unexpected response URL');
      ensure(Number(response.headers.get('content-length')??0)<=maxBytes,'Registry response size is too large');
      ensure(response.body,'Registry response body is absent');const reader=response.body.getReader();const chunks=[];let bytes=0;
      try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;ensure(bytes<=maxBytes,'Registry response size is too large');chunks.push(value);}}
      catch(error){reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    })()]);
  } finally {clearTimeout(timer);controller.abort();}
}

export async function generateIndex(config,options={}) {
  validatePins(config);const versions=[];
  for(const pin of config.plugins){
    const packument=await fetchPackument(pin.name,options);
    ensure(packument?.name===pin.name,'Registry package name mismatch');
    ensure(packument.versions&&Object.hasOwn(packument.versions,pin.version),'Pinned version is absent from registry');
    const manifest=packument.versions[pin.version];ensure(manifest?.name===pin.name&&manifest.version===pin.version,'Pinned manifest name/version mismatch');
    ensure(manifest.deprecated===undefined||manifest.deprecated==='','Pinned version is deprecated');
    const patch=manifest.dsh?.bundle?.patch;
    ensure(typeof patch==='string'&&patch.startsWith('./')&&!patch.includes('\\')&&!/[?#:\u0000]/u.test(patch)&&!patch.split('/').includes('..')&&path.posix.normalize(patch)===patch.slice(2),'Missing or unsafe dsh.bundle.patch');
    const time=packument.time?.[pin.version];const milliseconds=typeof time==='string'?Date.parse(time):NaN;
    ensure(Number.isFinite(milliseconds)&&milliseconds>=0&&new Date(milliseconds).toISOString()===time,'Pinned publish time is missing or invalid');
    const dsh=manifest.engines?.dsh;ensure(typeof dsh==='string'&&dsh.trim()!=='','Pinned engines.dsh is missing');
    versions.push(versionEntry(pin.version,Math.floor(milliseconds/1000),dsh));
  }
  const index=document(config,versions);const parsed=parseMarketIndex(index,VALIDATION_URL);
  for(const plugin of parsed.plugins)ensure(marketInstallTarget(plugin.name,plugin.versions[0]).spec===plugin.name+'@'+plugin.versions[0].version,'Install target must remain pinned');
  return index;
}

async function existingFile(file) {
  try{return await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function updateFile({config,indexFile,...options}) {
  // Finish every registry and schema check before touching the previous index.
  const bytes=serialize(await generateIndex(config,options));if(await existingFile(indexFile)===bytes)return {changed:false};
  const temporary=indexFile+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,indexFile);}
  finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {changed:true};
}
export async function checkFile({config,indexFile,online=false,...options}) {
  validatePins(config);const bytes=await fs.readFile(indexFile,'utf8');const index=JSON.parse(bytes);
  parseMarketIndex(index,VALIDATION_URL);
  ensure(index.plugins.length===config.plugins.length,'Stale plugin list');
  const versions=index.plugins.map((plugin,i)=>{
    const pin=config.plugins[i];const value=plugin.versions[0];ensure(plugin.name===pin.name&&plugin.versions.length===1&&value.version===pin.version,'Stale pinned version');
    ensure(value.source.type==='npm'&&value.source.registry===REGISTRY+'/','Stored registry must be canonical npm');
    ensure(typeof value.engines?.dsh==='string'&&value.engines.dsh.trim()!=='','Stored engines.dsh is missing');
    return versionEntry(pin.version,value.publishTimestamp,value.engines.dsh);
  });
  ensure(bytes===serialize(document(config,versions)),'Stale metadata or non-canonical index bytes');
  if(online)ensure(bytes===serialize(await generateIndex(config,options)),'Index is stale relative to reviewed registry versions');
  return {plugins:index.plugins.length,online};
}
