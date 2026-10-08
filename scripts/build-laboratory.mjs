import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const destination=resolve(root,process.argv[2]||'build/laboratory.mjs');
const parts=[];
for(const name of ['implanta-core.mjs','reconciliation-core.mjs','dashboard.mjs','laboratory.mjs']){
 let source=await readFile(resolve(root,'lab-src',name),'utf8');
 source=source.replace(/^import[^\n]*\n/gm,'');
 if(name!=='laboratory.mjs')source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/g,'');
 parts.push(source);
}
const content=parts.join('\n');
await mkdir(dirname(destination),{recursive:true});await writeFile(destination,content,'utf8');
console.log(JSON.stringify({output:destination,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')}));
