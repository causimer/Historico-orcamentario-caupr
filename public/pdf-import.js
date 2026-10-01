export function parsePages(pages, resolve = x => ({nome:x})) {
 const keys=['Orc_Desbloq','Empenhado','Liquidado','Pago'];
 const zero=()=>Object.fromEntries(keys.map(k=>[k,0]));
 const centros={},totalGeral=zero(),dates=new Set();
 let conta='',centro='',block=null,count=0,title=false;
 const num=s=>Number(s.replace(/\./g,'').replace(',','.'));
 function finish(){if(!block)return;if(block.step!==4)throw Error('Bloco incompleto: '+centro+' / '+conta);const name=resolve(centro).nome;const c=centros[name] ||= {contas:{},subtotal:zero()};const v=c.contas[conta] ||= zero();for(const k of keys){v[k]+=block.values[k];c.subtotal[k]+=block.values[k];totalGeral[k]+=block.values[k];}count++;block=null;}
 for(const lines of pages){let pageDate=false;for(const raw of lines){const line=raw.replace(/\s+/g,' ').trim();
 if(line.includes('Relatório de Disponibilidade Orçamentária'))title=true;
 const d=line.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/);if(d){const iso=`${d[3]}-${d[2]}-${d[1]}`;if(new Date(iso+'T12:00:00Z').toISOString().slice(0,10)!==iso)throw Error('Data inválida no PDF.');dates.add(iso);pageDate=true;}
 if(line.startsWith('Conta:')){finish();conta=line.slice(6).trim();centro='';continue;}
 if(line.startsWith('Centro de Custo:') && line.slice(16).trim()){finish();centro=line.slice(16).trim();continue;} if(/^\d[\d.]+\s*-\s/.test(line)){finish();centro=line;continue;}
 const m=line.match(/^(PRÉ-EMPENHADO|EMPENHADO|LIQUIDADO|PAGO)\s/);if(!m)continue;
 const expected=['PRÉ-EMPENHADO','EMPENHADO','LIQUIDADO','PAGO'];if(!conta||!centro)throw Error('Despesa sem conta ou centro de custo.');
 if(m[1]==='PRÉ-EMPENHADO'){finish();block={step:0,values:zero()};}
 if(!block||m[1]!==expected[block.step])throw Error('Ordem de despesas inesperada: '+line);
 const values=line.match(/-?\d[\d.]*,\d{2}/g);if(!values||values.length!==4)throw Error('Quatro colunas monetárias não identificadas: '+line);
 block.values[keys[block.step]]=num(values[block.step===0?2:0]);block.step++;
 }if(!pageDate)throw Error('Página sem data de referência. PDF incompleto ou digitalizado.');}
 finish();if(!title||dates.size!==1||!count)throw Error('PDF inválido ou com referências diferentes.');
 for(const k of keys)totalGeral[k]=Math.round(totalGeral[k]*100)/100;
 return {date:[...dates][0],centros,totalGeral,avisos:[],origem:{formato:'pdf',coluna:'na_data',parserVersion:4,paginas:pages.length,blocos:count}};
}
export async function readPdf(file, resolve, progress) {
 const pdfjs=await import('./vendor/pdfjs/pdf.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
 let doc;try{doc=await task.promise;const pages=[];
 for(let n=1;n<=doc.numPages;n++){progress?.(n,doc.numPages);const page=await doc.getPage(n);const text=await page.getTextContent();const groups=[];
 for(const item of text.items){if(!item.str?.trim())continue;let g=groups.find(g=>Math.abs(g.y-item.transform[5])<2);if(!g){g={y:item.transform[5],items:[]};groups.push(g);}g.items.push(item);}
 pages.push(groups.sort((a,b)=>b.y-a.y).map(g=>g.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join(' ')));page.cleanup();}
 const result=parsePages(pages,resolve);result.origem.arquivo=file.name;return result;
 }finally{await task.destroy();}
}

