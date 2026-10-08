import { parseExactJson, cents, formatMoney, buildQuery, collect, flattenRows } from './implanta-core.mjs';

const SOURCES = [
 ['DemonstrativoEmpenhosPagamentos','Empenhos e pagamentos por conta','monthly'],
 ['DespesasCentroCusto','Despesas por centro de custo','monthly'],
 ['BalancoOrcamentario','Balanço orçamentário','monthly'],
 ['ComparativoDespesa','Comparativo de despesa','monthly'],
 ['ComparativoReceita','Comparativo de receita','monthly'],
 ['PlanoDeContas','Plano de contas','annual'],
 ['ExecucaoFinanceira','Execução financeira','daily'],
 ['Balancete','Balancete','monthly'],
 ['BalancoFinanceiro','Balanço financeiro','monthly'],
 ['BalancoPatrimonial','Balanço patrimonial','monthly'],
 ['FluxoCaixa','Fluxo de caixa','monthly'],
 ['VariacoesPatrimoniais','Variações patrimoniais','monthly']
];
function el(tag,text,cls) { const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e; }
function button(text,fn) {const b=el('button',text,'btn');b.type='button';b.addEventListener('click',fn);return b;}
function label(text,input) {const l=el('label',text);l.append(input);return l;}
function select(items) {const s=el('select');for(const [value,text] of items){const o=el('option',text);o.value=value;s.append(o);}return s;}
function input(type,value) {const i=el('input');i.type=type;i.value=value;return i;}
function download(name,content,mime='application/json') {const u=URL.createObjectURL(new Blob([content],{type:mime}));const a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function walk(value,path='$',rows=[]) {
 if(Array.isArray(value))value.forEach((v,i)=>walk(v,`${path}[${i}]`,rows));
 else if(value&&typeof value==='object'){rows.push({path,value});for(const[k,v]of Object.entries(value))if(Array.isArray(v))walk(v,`${path}.${k}`,rows);}
 return rows;
}
function scalar(value){if(value===null)return 'nulo';if(value===undefined)return 'ausente';if(typeof value==='object')return Array.isArray(value)?`${value.length} itens (abra o registro)`:'objeto (abra o registro)';return String(value);}
const moneyLabel = value => value===null||value===undefined?'Indisponível':formatMoney(String(value));

export function mountLaboratory(context) {
 const {root,readAsset,isAuthorized,getSnapshotDates,getSnapshot,centerMap}=context;
 let alive=true,controller=null,current=null,rows=[],page=0,versions=[],guideLoaded=false,contract=null,selectionRevision=0;
 const canUse=()=>alive&&isAuthorized();
 root.replaceChildren();root.className='lab';
 root.append(el('p','ÁREA DE TESTE · ACESSO INDIVIDUAL','lab-eyebrow'),el('h2','Laboratório Implanta'));
 root.append(el('p','Consulte as fontes públicas, examine os registros e confira as diferenças com o histórico. Os resultados deste ambiente ainda precisam de validação contábil.','muted'));
 const notice=el('div',undefined,'card lab-notice');notice.append(el('strong','Seus retratos atuais continuam sendo a referência do painel.'),el('p','Uma consulta nova fica nesta sessão do navegador. Para guardar os bytes e a origem, use os botões de download. Esta etapa não importa dados para a Situação atual e não agenda coletas.'));root.append(notice);
 const tabs=el('div',undefined,'lab-tabs');const panels={};
 function show(name){if(!canUse())return;for(const[k,p]of Object.entries(panels))p.hidden=k!==name;for(const b of tabs.children)b.classList.toggle('primary',b.dataset.panel===name);if(name==='reconcile')refreshSnapshotChoices();}
 for(const [id,title]of [['query','Consultas e gráficos'],['reconcile','Conciliação'],['docs','Documentação'],['contract','Contrato da API']]){const b=button(title,()=>{show(id);if(id==='docs')loadGuide();if(id==='contract')loadContract();});b.dataset.panel=id;tabs.append(b);panels[id]=el('div');panels[id].hidden=true;}
 root.append(tabs,...Object.values(panels));show('query');
 const query=panels.query,form=el('div',undefined,'card'),fields=el('div',undefined,'lab-fields');
 const source=select(SOURCES.map(s=>[s[0],s[1]]));source.id='labSource';
 const start=input('month','2026-06'),end=input('month','2026-06'),year=input('number','2026');year.min='2000';year.max='2100';
 start.id='labStart';end.id='labEnd';year.id='labYear';
 const report=select([['','Padrão da Implanta'],['OffLine','OffLine'],['OnLine','OnLine']]);report.id='labReport';
 const startLabel=label('Referência inicial',start),endLabel=label('Referência final',end),yearLabel=label('Exercício',year),reportLabel=label('Modo do demonstrativo',report);
 fields.append(label('Fonte',source),startLabel,endLabel,yearLabel,reportLabel);form.append(el('h3','Nova consulta'),fields);
 const actions=el('div',undefined,'lab-actions');const status=el('p','Escolha uma fonte e uma referência.','muted');status.id='labStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const run=button('Consultar agora',runQuery),cancel=button('Cancelar consulta',()=>controller?.abort());cancel.disabled=true;run.classList.add('primary');actions.append(run,cancel);form.append(actions,status);query.append(form);
 const history=el('div',undefined,'card');const saved=select([['','Escolha uma resposta preservada…']]);saved.id='labPreserved';history.append(el('h3','Respostas preservadas'),el('p','São consultas verificadas em 08/10/2026. Abrir uma delas não chama a API novamente. Consultas desta sessão também aparecem aqui.','muted'),label('Versão',saved));query.append(history);
 const result=el('div');query.append(result);
 const reconcile=panels.reconcile;reconcile.append(el('div','A comparação por conta é uma conferência exploratória. Conta contábil, centro de custo, referência e estágio da despesa precisam representar a mesma coisa antes de qualquer substituição.','card lab-notice'));
 const compareCard=el('div',undefined,'card');const snapDate=select([['','Selecione um retrato…'],...getSnapshotDates().map(d=>[d,d.split('-').reverse().join('/')])]);snapDate.id='labSnapshotDate';const comparison=el('div');compareCard.append(el('h3','API por conta × retrato importado'),label('Retrato para comparar',snapDate),button('Conferir a resposta selecionada',compareCurrent),comparison);reconcile.append(compareCard);
 function refreshSnapshotChoices(){const chosen=snapDate.value;const dates=getSnapshotDates();snapDate.replaceChildren();for(const [value,text] of [['',dates.length?'Selecione um retrato…':'Histórico em carregamento; reabra esta aba'],...dates.map(d=>[d,d.split('-').reverse().join('/')])]){const option=el('option',text);option.value=value;snapDate.append(option);}if(dates.includes(chosen))snapDate.value=chosen;}
 const reconcileReport=el('div',undefined,'card');reconcileReport.append(el('h3','Conferência realizada nesta implantação'),el('p','Carregando a análise de junho de 2026…','muted'));reconcile.append(reconcileReport);
 readAsset('reconciliation').then(a=>{if(canUse()){reconcileReport.replaceChildren(el('h3','Conferência realizada nesta implantação'));renderDocument(a.content,reconcileReport);}}).catch(()=>{if(canUse())reconcileReport.append(el('p','Não foi possível carregar a análise. Tente abrir novamente.'));});
 function updateInputs(){const mode=SOURCES.find(s=>s[0]===source.value)[2];const previousType=start.type;const type=mode==='daily'?'date':'month';if(previousType!==type){start.type=type;end.type=type;start.value=mode==='daily'?'2026-06-01':'2026-06';end.value=mode==='daily'?'2026-06-30':'2026-06';}startLabel.hidden=endLabel.hidden=mode==='annual';yearLabel.hidden=mode!=='annual';reportLabel.hidden=source.value!=='DemonstrativoEmpenhosPagamentos';}
 source.addEventListener('change',updateInputs);updateInputs();
 saved.addEventListener('change',async()=>{
  if(!canUse()||!saved.value)return;
  const revision=++selectionRevision;
  status.textContent='Abrindo a resposta preservada…';
  try {
   const item=versions.find(v=>v.id===saved.value);
   if(!item)throw new Error('Versão indisponível.');
   const record=item.record||await readAsset(item.asset);
   if(!canUse()||selectionRevision!==revision)return;
   const bytes=record.bytes||new TextEncoder().encode(record.raw),hash=await sha(bytes);
   if(!canUse()||selectionRevision!==revision)return;
   if(hash!==record.sha256)throw new Error('A conferência de integridade falhou.');
   current={...record,bytes,data:parseExactJson(record.raw)};
   renderResult();status.textContent='Resposta preservada aberta e hash conferido.';
  }catch(e){if(canUse()&&selectionRevision===revision)status.textContent=e.message;}
 });
 async function sha(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
 async function runQuery(){if(!canUse())return;const queryValues={source:source.value,start:start.value,end:end.value,year:year.value,report:source.value==='DemonstrativoEmpenhosPagamentos'?report.value:''};const revision=++selectionRevision;controller=new AbortController();run.disabled=true;cancel.disabled=false;status.textContent='Consultando a Implanta. Aguarde até 60 segundos…';try{
   const collected=await collect(queryValues.source,queryValues.start,queryValues.end,queryValues.year,queryValues.report,controller.signal);
   if(!canUse())return;
   const bytes=collected.bytes||new TextEncoder().encode(collected.raw);const raw=collected.raw||new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const hash=collected.sha256||await sha(bytes);
   if(!canUse())return;
   const record={...collected,raw,bytes,data:collected.data||parseExactJson(raw),sha256:hash,endpoint:queryValues.source,collectedAt:collected.collectedAt||new Date().toISOString(),kind:'Consulta nova na sessão'};
   const id=`session-${versions.length}`,version={id,label:`Consulta nova · ${queryValues.source} · ${queryValues.start||queryValues.year}`,record};versions.push(version);const o=el('option',version.label);o.value=id;saved.append(o);
   if(selectionRevision!==revision)return;
   current=record;saved.value=id;renderResult();status.textContent=current.data.length?'Consulta concluída. A origem e os registros estão abaixo.':'HTTP 200 com lista vazia. A origem não retornou registros para essa consulta.';
  }catch(e){if(canUse()&&selectionRevision===revision)status.textContent=`Consulta não concluída: ${e.message}. Nenhum vazio ou valor zero foi criado para representar a falha.`;}finally{controller=null;if(canUse()){run.disabled=false;cancel.disabled=true;}}}
 function renderResult(){result.replaceChildren();rows=walk(current.data);page=0;const card=el('div',undefined,'card');card.append(el('h3','Origem da resposta'));
  const meta=el('dl',undefined,'lab-meta');for(const[k,v]of [['Fonte',current.endpoint||new URL(current.url).pathname.split('/').at(-1)],['Consulta',current.url],['Coletada em',new Date(current.collectedAt||current.collected_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' · Brasília'],['Situação',current.kind||'Resposta preservada'],['HTTP',current.status||200],['Bytes',current.bytes.length],['Registros externos',current.data.length],['Objetos exibíveis',rows.length],['SHA-256',current.sha256]]){meta.append(el('dt',k),el('dd',String(v)));}card.append(meta);
  const buttons=el('div',undefined,'lab-actions');buttons.append(button('Baixar JSON original',()=>{if(canUse()&&current)download(`${current.endpoint||'implanta'}-${current.sha256.slice(0,12)}.json`,current.bytes);}),button('Baixar origem da consulta',()=>{if(canUse()&&current)download('origem-implanta.json',JSON.stringify({url:current.url,endpoint:current.endpoint,collectedAt:current.collectedAt||current.collected_at,status:current.status||200,bytes:current.bytes.length,sha256:current.sha256,storage:'Sessão do navegador; nenhuma importação nos retratos'},null,2));}));card.append(buttons);result.append(card);
  renderGraph(current.data,result);
  const explorer=el('div',undefined,'card');explorer.append(el('h3','Explorar registros'),el('p','Códigos e números mantêm os dígitos da resposta original. Nulo e campo ausente são mostrados separadamente. Pais e filhos aparecem com seu caminho; não são somados nesta tabela.','muted'));
  const search=input('search','');search.id='labSearch';search.placeholder='Código, conta, centro ou texto';const tableHost=el('div'),pager=el('div',undefined,'lab-actions');explorer.append(label('Buscar na resposta',search),tableHost,pager);result.append(explorer);
  function draw(){const q=search.value.toLocaleLowerCase('pt-BR');const filtered=rows.filter(r=>JSON.stringify(r.value).toLocaleLowerCase('pt-BR').includes(q));const limit=25;const last=Math.max(0,Math.ceil(filtered.length/limit)-1);page=Math.min(page,last);tableHost.replaceChildren();pager.replaceChildren();
    const shown=filtered.slice(page*limit,(page+1)*limit);const keys=[...new Set(shown.flatMap(r=>Object.keys(r.value)))];const scroll=el('div',undefined,'lab-table-scroll'),table=el('table'),head=el('tr');head.append(el('th','Caminho / registro'));keys.forEach(k=>head.append(el('th',k)));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
    for(const row of shown){const tr=el('tr'),td=el('td');td.append(button(row.path,()=>{const details=el('details');details.open=true;details.append(el('summary','Registro '+row.path),el('pre',JSON.stringify(row.value,null,2),'lab-json'));td.replaceChildren(details);}));tr.append(td);keys.forEach(k=>tr.append(el('td',scalar(row.value[k]))));body.append(tr);}table.append(body);scroll.append(table);tableHost.append(scroll);
    const prev=button('Anterior',()=>{page--;draw();}),next=button('Próxima',()=>{page++;draw();});prev.disabled=page===0;next.disabled=page===last;pager.append(prev,el('span',`${filtered.length} registros · página ${page+1} de ${last+1}`),next);
  }search.addEventListener('input',()=>{page=0;draw();});draw();
 }
 function renderGraph(data,target){const endpoint=current.endpoint||new URL(current.url).pathname.split('/').at(-1);let samples=[],description='';
  if(endpoint==='DemonstrativoEmpenhosPagamentos'){const records=walk(data).map(r=>r.value).filter(v=>v.ANALITICA===true);const seen=new Set();for(const v of records){const key=v.CONTA_CODIGO;if(!key||seen.has(key)){samples=[];break;}seen.add(key);const amount=cents(v.PAGO_EXERCICIO);if(amount===null){samples=[];break;}samples.push({label:`${key} · ${v.CONTA_NOME||v.NOME}`,value:amount});}description='Pago no exercício por conta analítica. Cada barra representa uma conta; contas sintéticas são excluídas. Não representa distribuição por centro.';}
  if(endpoint==='DespesasCentroCusto'){const records=data.filter(v=>v.ANALITICO===true);const groups=new Map(),seen=new Set();let valid=true;for(const v of records){const key=JSON.stringify([v.CODIGO_CENTRO_CUSTO,v.CODIGO_CONTA]);const amount=cents(v.VALOR_TOTAL);if(seen.has(key)||amount===null||!v.CODIGO_CENTRO_CUSTO){valid=false;break;}seen.add(key);const g=groups.get(v.CODIGO_CENTRO_CUSTO)||{label:`${v.CODIGO_CENTRO_CUSTO} · ${v.NOME_CENTRO_CUSTO}`,value:0n};g.value+=amount;groups.set(v.CODIGO_CENTRO_CUSTO,g);}if(valid)samples=[...groups.values()];description='VALOR_TOTAL das linhas com ANALITICO=true, agrupado por código de centro. O estágio da despesa não foi confirmado pela origem; este gráfico não é rotulado como pago ou dotação.';}
  if(!samples.length)return;samples.sort((a,b)=>a.value===b.value?0:a.value>b.value?-1:1);samples=samples.filter(s=>s.value>=0n).slice(0,8);if(!samples.length)return;const max=samples[0].value;
  const graph=el('div',undefined,'card');graph.append(el('h3','Exploração dos valores · 8 maiores'),el('p',description,'muted'));for(const sample of samples){const row=el('div',undefined,'lab-bar-row');row.append(el('div',sample.label),el('strong',formatMoney((sample.value/100n).toString()+'.'+(sample.value%100n).toString().padStart(2,'0'))));const track=el('div',undefined,'lab-bar-track'),bar=el('div',undefined,'lab-bar-fill');bar.style.width=max===0n?'0%':`${Number(sample.value*10000n/max)/100}%`;track.append(bar);row.append(track);graph.append(row);}target.append(graph);
 }
 function compareCurrent(){if(!canUse())return;comparison.replaceChildren();if(!current){comparison.append(el('p','Abra ou consulte primeiro um demonstrativo de empenhos e pagamentos.'));return;}const endpoint=current.endpoint||new URL(current.url).pathname.split('/').at(-1);if(endpoint!=='DemonstrativoEmpenhosPagamentos'){comparison.append(el('p','Selecione uma resposta do DemonstrativoEmpenhosPagamentos para comparar os estágios por conta.'));return;}const date=snapDate.value,snap=getSnapshot(date);if(!snap){comparison.append(el('p','Escolha um retrato disponível.'));return;}
  const url=new URL(current.url),term=url.searchParams.get('referenciaTermino'),expected=`${date.slice(5,7)}/${date.slice(0,4)}`;if(term!==expected){comparison.append(el('p',`Períodos diferentes: API ${term}; retrato ${expected}. Selecione o mesmo mês e exercício.`));return;}
  comparison.append(el('p',`API: referência ${term}. Retrato: ${date.split('-').reverse().join('/')}. A API mensal não comprova a posição diária deste retrato. Esta comparação não autoriza importação automática.`, 'import-warning'));
  const api=new Map(),duplicate=new Set();for(const row of walk(current.data)){const v=row.value;if(v.ANALITICA===true&&typeof v.CONTA_CODIGO==='string'){if(api.has(v.CONTA_CODIGO))duplicate.add(v.CONTA_CODIGO);api.set(v.CONTA_CODIGO,v);}}
  const imported=new Map();let rejected=0;for(const center of Object.values(snap.centros||{}))for(const[key,v]of Object.entries(center.contas||{})){const m=key.match(/^(\d+(?:\.\d+)+)\s*(?:-|$)/);if(!m){rejected++;continue;}const values=['Empenhado','Liquidado','Pago'].map(k=>typeof v[k]==='number'&&Number.isFinite(v[k])?cents(v[k].toFixed(2)):cents(v[k]));if(values.some(x=>x===null)){rejected++;continue;}const old=imported.get(m[1])||[0n,0n,0n];imported.set(m[1],old.map((x,i)=>x+values[i]));}
  const table=el('table'),head=el('tr');['Código de conta (candidato)','Estágio','API no exercício','Retrato somado por centro','Diferença API − retrato','Conferência'].forEach(t=>head.append(el('th',t)));const th=el('thead');th.append(head);table.append(th);const body=el('tbody');let matches=0;const keys=new Set([...api.keys(),...imported.keys()]);
  for(const key of [...keys].sort()){const a=api.get(key),b=imported.get(key);for(const[k,idx,name]of [['EMPENHADOEXERCICIO',0,'Empenhado'],['LIQUIDADO_EXERCICIO',1,'Liquidado'],['PAGO_EXERCICIO',2,'Pago']]){const av=a?cents(a[k]):null,bv=b?b[idx]:null;const diff=av===null||bv===null?null:av-bv;const value=x=>x===null?'Indisponível':formatMoney((x<0n?'-':'')+(abs(x)/100n).toString()+'.'+(abs(x)%100n).toString().padStart(2,'0'));const state=duplicate.has(key)?'Código duplicado na API':diff===null?'Sem correspondência':diff===0n?'Valor coincide; semântica pendente':'Divergente';if(diff===0n&&!duplicate.has(key))matches++;const tr=el('tr');[key,name,value(av),value(bv),value(diff),state].forEach(t=>tr.append(el('td',t)));body.append(tr);}}
  table.append(body);const scroll=el('div',undefined,'lab-table-scroll');scroll.append(table);comparison.append(el('p',`${keys.size} códigos candidatos · ${matches} valores coincidentes · ${rejected} linhas sem código ou valor apto à comparação. Códigos são extraídos explicitamente do rótulo do retrato; ainda precisam de homologação.`),scroll);
 }
 function abs(v){return v<0n?-v:v;}
 function renderDocument(text,target){for(const chunk of text.split(/\n\s*\n/)){if(/^#{1,4}\s/.test(chunk)){const line=chunk.split('\n');target.append(el(/^#\s/.test(chunk)?'h3':'h4',line[0].replace(/^#+\s/,'')));if(line.length>1)target.append(el('p',line.slice(1).join('\n'),'lab-prose'));}else target.append(el('p',chunk,'lab-prose'));}}
 async function loadGuide(){if(!canUse()||guideLoaded)return;panels.docs.replaceChildren(el('p','Carregando a documentação privada…'));try{const a=await readAsset('documentation');if(!canUse())return;panels.docs.replaceChildren();const tools=el('div',undefined,'lab-actions');tools.append(button('Baixar documentação (.md)',()=>{if(canUse())download('documentacao-historico-implanta.md',a.content,'text/markdown;charset=utf-8');}));panels.docs.append(tools);const card=el('article',undefined,'card lab-guide');renderDocument(a.content,card);panels.docs.append(card);guideLoaded=true;}catch(e){if(canUse())panels.docs.replaceChildren(el('p','Não foi possível carregar a documentação. Abra esta aba novamente.'));}}
 async function loadContract(){if(!canUse()||contract)return;panels.contract.replaceChildren(el('p','Carregando o contrato verificado…'));try{const a=await readAsset('contract');if(!canUse())return;contract=JSON.parse(a.content);panels.contract.replaceChildren();const card=el('div',undefined,'card');card.append(el('h3','33 operações · 45 modelos · 473 propriedades'),el('p','Contrato Swagger 2.0 verificado em 08/10/2026. A lista documenta o que a API oferece; não significa que todas as rotas tenham sido consultadas ou conciliadas.','muted'),button('Baixar Swagger original',()=>{if(canUse())download('implanta-swagger.json',a.content);}));
  for(const[path,def]of Object.entries(contract.paths)){const d=el('details');d.append(el('summary',`GET ${path} · ${def.get?.summary||''}`));for(const p of def.get?.parameters||[])d.append(el('p',`${p.name} · ${p.type} · ${p.required?'obrigatório':'opcional'} · ${p.description||'Sem descrição'}`));const model=def.get?.responses?.['200']?.schema?.items?.$ref?.split('/').at(-1);if(model){d.append(el('h4',model));for(const[k,v]of Object.entries(contract.definitions[model]?.properties||{}))d.append(el('p',`${k} · ${v.type||v.$ref||'estrutura'}${v.format?' · '+v.format:''}`));}card.append(d);}panels.contract.append(card);}catch(e){if(canUse())panels.contract.replaceChildren(el('p','Não foi possível carregar o contrato. Abra esta aba novamente.'));}}
 readAsset('index').then(index=>{if(!canUse())return;const preserved=JSON.parse(index.content);versions=[...preserved,...versions];for(const item of preserved){const o=el('option',item.label);o.value=item.id;saved.append(o);}if(!current&&selectionRevision===0){saved.value=preserved[0]?.id||'';saved.dispatchEvent(new Event('change'));}}).catch(()=>{if(canUse()&&selectionRevision===0)status.textContent='As respostas preservadas não carregaram. Você pode fazer uma consulta nova.';});
 return {destroy(){alive=false;selectionRevision++;controller?.abort();current=null;rows=[];versions=[];contract=null;root.replaceChildren();}};
}
