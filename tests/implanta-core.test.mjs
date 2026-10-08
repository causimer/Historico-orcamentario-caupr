import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseExactJson,cents,formatMoney,buildQuery,collect,flattenRows,MAX_RESPONSE_BYTES} from '../lab-src/implanta-core.mjs';

test('parser preserva decimais, inteiros grandes, expoentes e códigos originais', () => {
  const raw = '{"valor":9007199254740993.01,"saldo":-0.00,"e":1.20e+2,"codigo":"4.9.1 ","str":"99.001 e \\\"texto\\\"","null":null,"bool":true,"array":[false,0,2]}';
  assert.deepEqual(parseExactJson(raw), {valor:'9007199254740993.01',saldo:'-0.00',e:'1.20e+2',codigo:'4.9.1 ',str:'99.001 e "texto"',null:null,bool:true,array:[false,'0','2']});
  assert.deepEqual(parseExactJson('\uFEFF [ {"nome":"CAU/PR — ação"} ]'), [{nome:'CAU/PR — ação'}]);
  const proto = parseExactJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(proto.__proto__.polluted, true);
});

test('parser rejeita sintaxe que não é JSON e controles inválidos', () => {
  for (const raw of ['', '{1:2}', '{"x":01}', '[1,]', '{"x":NaN}', '[Infinity]', 'truefalse', '1 2', '{"x":"\n"}', '{"x":1,}', '{"x":1e}', '[.5]', '[+1]']) assert.throws(() => parseExactJson(raw), SyntaxError, raw);
  assert.throws(() => parseExactJson('['.repeat(302)+'0'+']'.repeat(302)), RangeError);
});

test('centavos são exatos e ausência/subcentavo não se tornam zero', () => {
  assert.equal(cents('9007199254740993.01'), 900719925474099301n);
  assert.equal(cents('0'),0n);
  assert.equal(cents('-0.00'),0n);
  assert.equal(cents('12.3000'),1230n);
  assert.equal(cents('1.20e+2'),12000n);
  assert.equal(cents('120e-2'),120n);
  assert.equal(cents('-123.45'),-12345n);
  assert.equal(cents(12345n),12345n);
  for (const value of [null,undefined,0,1.23,true,'',' ','12,30','R$ 12.30','01','1.001','1386346.0199999998','1e-3','NaN','Infinity','1e1000']) assert.equal(cents(value),null,String(value));
});

test('formatação financeira não perde centavos acima do inteiro seguro', () => {
  assert.equal(formatMoney('9007199254740993.01'),'R$ 9.007.199.254.740.993,01');
  assert.equal(formatMoney('-123.45'),'R$ -123,45');
  assert.equal(formatMoney(12345n),'R$ 123,45');
  assert.equal(formatMoney('0'),'R$ 0,00');
  assert.equal(formatMoney(null),'Indisponível');
  assert.equal(formatMoney('1.001'),'Indisponível');
});

test('consultas validam calendário, período e whitelist e geram parâmetros oficiais', () => {
  const month = new URL(buildQuery('BalancoOrcamentario','2026-06-01','2026-06-30'));
  assert.equal(month.origin,'https://cau-pr.implanta.net.br');
  assert.equal(month.pathname,'/portalTransparencia/api/v1.0/BalancoOrcamentario');
  assert.equal(month.searchParams.get('referenciaInicio'),'06/2026');
  assert.equal(month.searchParams.get('referenciaTermino'),'06/2026');
  assert.equal(new URL(buildQuery('Balancete','2026-01','2026-09')).searchParams.get('referenciaInicio'),'01/2026');
  assert.equal(new URL(buildQuery('Balancete','01/2026','09/2026')).searchParams.get('referenciaTermino'),'09/2026');
  assert.equal(new URL(buildQuery('ExecucaoFinanceira','2024-02-01','2024-02-29')).searchParams.get('referenciaTermino'),'29/02/2024');
  assert.equal(new URL(buildQuery('PlanoDeContas',null,null,'2026')).searchParams.get('exercicio'),'2026');
  assert.equal(new URL(buildQuery('DemonstrativoEmpenhosPagamentos','2026-06','2026-06',null,'OnLine')).searchParams.get('tipoRelatorio'),'OnLine');
  for (const endpoint of ['../Pagamentos','https://evil.test/','toString','__proto__','Pagamentos']) assert.throws(()=>buildQuery(endpoint,'2026-06','2026-06'));
  for (const [start,end] of [['2026-02-30','2026-03-01'],['2026-02-29','2026-03-01'],['2026-13','2026-13'],['2026-00','2026-06'],['2026-09','2026-06'],['2025-12','2026-01'],['2026-6','2026-06']]) assert.throws(()=>buildQuery('Balancete',start,end));
  assert.throws(()=>buildQuery('PlanoDeContas',null,null,'20x6'));
  assert.throws(()=>buildQuery('Balancete','2026-06','2026-06',null,'OnLine'));
  assert.throws(()=>buildQuery('DemonstrativoEmpenhosPagamentos','2026-06','2026-06',null,'online'));
});

test('flatten percorre contas, detalhes e contrapartidas mantendo caminhos e sem agregar', () => {
  const data = [{Codigo:'6',Analiticas:[{Codigo:'6.1'}],DETALHES:[{CODIGO:'A',CONTRA_PARTIDA:[{CONTA_CONTABIL:'X',VALOR_LANCAMENTO:'1.00'}]}]}];
  const rows=flattenRows(data);
  assert.deepEqual(rows.map(r=>r.path),['$[0]','$[0].Analiticas[0]','$[0].DETALHES[0]','$[0].DETALHES[0].CONTRA_PARTIDA[0]']);
  assert.equal(rows[3].parentPath,'$[0].DETALHES[0]');
  assert.equal(rows[3].relation,'CONTRA_PARTIDA');
  assert.equal(rows[0].row,data[0]);
  assert.throws(()=>flattenRows([null]));
  assert.throws(()=>flattenRows([{DETALHES:{}}]));
  const circular={Analiticas:[]};circular.Analiticas.push(circular);assert.throws(()=>flattenRows([circular]));
  assert.deepEqual(flattenRows([]),[]);
});

function response(raw,status=200,headers={}) {
  return new Response(raw,{status,headers:{'content-type':'application/json; charset=utf-8',...headers}});
}
async function fakeFetch(fetcher,fn) {
  const previous=globalThis.fetch;globalThis.fetch=fetcher;
  try {return await fn();} finally {globalThis.fetch=previous;}
}

test('collect preserva os bytes, calcula hash e usa leitura sem credenciais e sem cache', async () => {
  const raw='[ { "CODIGO": "4.9.1 ", "VALOR": 9007199254740993.01, "DETALHES": null } ]\r\n';
  let options;
  const result=await fakeFetch(async(url,init)=>{options=init;return response(raw);},()=>collect('Balancete','2026-06','2026-06'));
  assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');
  assert.equal(result.status,200);assert.equal(result.raw,raw);assert.ok(result.bytes instanceof Uint8Array);
  assert.equal(result.sha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.data[0].VALOR,'9007199254740993.01');assert.equal(result.data[0].CODIGO,'4.9.1 ');
  assert.equal(result.data[0].DETALHES,null);assert.ok(result.collectedAt);
  const empty=await fakeFetch(async()=>response('[]'),()=>collect('Balancete','2026-09','2026-09'));
  assert.deepEqual(empty.data,[]);assert.equal(empty.recordCount,0);
});

test('collect rejeita erros HTTP, HTML, JSON e registros malformados', async () => {
  for (const [res,pattern] of [[response('{"message":"erro"}',500),/HTTP 500/],[new Response('<html>erro</html>',{headers:{'content-type':'text/html'}}),/não respondeu JSON/],[response('{bad'),/JSON inválido/],[response('{"message":"erro"}'),/lista de registros/],[response('[null]'),/Registro inválido/],[response('[{"DETALHES":{}}]'),/Lista inválida/]]) {
    await fakeFetch(async()=>res,()=>assert.rejects(collect('Balancete','2026-06','2026-06'),pattern));
  }
  await fakeFetch(async()=>response(new Uint8Array([0xff])),()=>assert.rejects(collect('Balancete','2026-06','2026-06'),/encoded data|codific/i));
});

test('limite de bytes usa cabeçalho e também a leitura efetiva do stream', async () => {
  await fakeFetch(async()=>response('[]',200,{'content-length':String(MAX_RESPONSE_BYTES+1)}),()=>assert.rejects(collect('Balancete','2026-06','2026-06'),/20 MB/));
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  await fakeFetch(async()=>response(stream),()=>assert.rejects(collect('Balancete','2026-06','2026-06'),/20 MB/));
  assert.equal(cancelled,true);
});

test('cancelamento externo é distinguido de resposta vazia', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(collect('Balancete','2026-06','2026-06',null,null,controller.signal),{name:'AbortError'});
  await fakeFetch(async(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})),async()=>{
    const next=new AbortController();const pending=collect('Balancete','2026-06','2026-06',null,null,next.signal);next.abort();
    await assert.rejects(pending,{name:'AbortError'});
  });
});

test('timeout de 60s é informado como falha, sem substituir por lista vazia', async () => {
  const previous=globalThis.setTimeout;
  globalThis.setTimeout=(callback,ms,...args)=>previous(callback,ms===60000?1:ms,...args);
  try {
    await fakeFetch(async(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})),()=>assert.rejects(collect('Balancete','2026-06','2026-06'),/60 segundos.*não significa ausência/));
  } finally {globalThis.setTimeout=previous;}
});

test('fixture oficial confirma precisão e população de folhas sem somar toda hierarquia', {skip: process.env.IMPLANTA_AUDIT_FIXTURE ? false : 'Fixture de auditoria privada ausente: informe IMPLANTA_AUDIT_FIXTURE.'}, async () => {
  const raw=await readFile(process.env.IMPLANTA_AUDIT_FIXTURE,'utf8');
  const data=parseExactJson(raw),rows=flattenRows(data);
  assert.equal(rows.length,146);
  const leaves=rows.filter(entry=>entry.row.ANALITICA===true);
  assert.equal(leaves.length,105);
  const total=leaves.reduce((sum,entry)=>sum+cents(entry.row.EMPENHADOEXERCICIO),0n);
  assert.equal(total,1459982897n);
  assert.equal(formatMoney(total),'R$ 14.599.828,97');
  assert.equal(rows.filter(entry=>entry.row.CENTRO_NOME!==null).length,0);
});
