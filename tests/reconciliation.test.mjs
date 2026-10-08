import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseExactJson} from '../lab-src/implanta-core.mjs';
import {reconcileSnapshot,snapshotCents} from '../lab-src/reconciliation-core.mjs';

const mapping={'1.01':{seq:1,nomeFinal:'CENTRO A'},'1.02':{seq:2,nomeFinal:'CENTRO B'}};
const metrics=(empenhado='10.00',liquidado='5.00',pago='3.00',saldo='90.00')=>({Empenhado:empenhado,Liquidado:liquidado,Pago:pago,Orc_Desbloq:saldo});
const snapshot=(accounts={'6.2.1 - Nome importado':metrics()})=>({date:'2026-06-30',centros:{'01 - CENTRO A':{contas:accounts,subtotal:metrics('999999')}}});
const demo=(changes={})=>({CONTA_CODIGO:'6.2.1',CONTA_NOME:'Nome API diferente',ANALITICA:true,ORCADO:'100.00',EMPENHADOEXERCICIO:'10.00',LIQUIDADO_EXERCICIO:'5.00',PAGO_EXERCICIO:'3.00',SALDO_ORCAMENTARIO:'90.00',SALDO_A_LIQUIDAR:'5.00',SALDO_A_PAGAR:'2.00',...changes});
const center=(changes={})=>({CODIGO_CENTRO_CUSTO:'1.01',NOME_CENTRO_CUSTO:'Nome sem correspondência textual',CODIGO_CONTA:'6.2.1',NOME_CONTA:'Conta API',ANALITICO:true,VALOR_TOTAL:'10.00',ORCAMENTO:'0.00',SALDO:'-10.00',...Object.fromEntries('JAN FEV MAR ABR MAI JUN JUL AGO SET OUT NOV DEZ'.split(' ').map(month=>['VALOR_'+month,month==='JUN'?'10.00':'0.00'])),...changes});

test('snapshotCents arredonda resíduos históricos com regra decimal explícita',()=>{
  assert.equal(snapshotCents(1386346.0199999998),138634602n);
  assert.equal(snapshotCents(1.005),101n);
  assert.equal(snapshotCents(-1.005),-101n);
  assert.equal(snapshotCents('999999999999999999.999'),100000000000000000000n);
  assert.equal(snapshotCents('1e-2'),1n);
  assert.equal(snapshotCents(0),0n);
  for(const value of [null,undefined,'',true,NaN,Infinity,Number.MAX_SAFE_INTEGER,'R$ 10,00'])assert.equal(snapshotCents(value),null);
});

test('cruzamento usa códigos e contas analíticas, recompõe orçamento e ignora subtotal salvo',()=>{
  const result=reconcileSnapshot(snapshot(),[demo(),demo({ANALITICA:false,ORCADO:'100000'})],[center()],()=>mapping);
  assert.equal(result.accounts.length,1);assert.equal(result.accounts[0].status,'match');
  assert.equal(result.accounts[0].name,'Nome API diferente');
  assert.equal(result.totals.snapshot.orcado,10000n);assert.equal(result.totals.snapshot.empenhado,1000n);
  assert.equal(result.totals.api.orcado,10000n);assert.equal(result.totals.diff.empenhado,0n);
  assert.equal(result.centers[0].label,'01 - CENTRO A');assert.equal(result.centers[0].status,'match');
  assert.equal(result.centers[0].api.candidateEmpenhado,1000n);
  assert.equal(result.centers[0].snapshot.orcado,10000n);
  assert.equal(result.centers[0].api.reportedOrcamento,0n);
  assert.equal(result.centers[0].api.orcado,undefined);
  assert.equal(result.centers[0].api.stageConfirmed,false);
  assert.equal(result.centers[0].accounts[0].executionDiff,0n);
});

test('conta distribuída em dois centros é somada legitimamente por código',()=>{
  const s=snapshot({'6.2.1 - Qualquer título':metrics('4','2','1','40')});
  s.centros['02 - CENTRO B']={contas:{'6.2.1 - Outro título':metrics('6','3','2','50')}};
  const result=reconcileSnapshot(s,[demo()],[center({VALOR_TOTAL:'4'}),center({CODIGO_CENTRO_CUSTO:'1.02',VALOR_TOTAL:'6'})],mapping);
  assert.equal(result.accounts[0].status,'match');assert.equal(result.accounts[0].snapshot.empenhado,1000n);
  assert.equal(result.counts.centersMatched,2);assert.equal(result.totals.centersCandidateDiff,0n);
});

test('dinheiro com precisão acima de Number conserva centavos exatos',()=>{
  const big='9007199254740993.01';
  const result=reconcileSnapshot(snapshot({'6.2.1 - Grande':metrics(big,big,big,'0')}),[demo({ORCADO:big,EMPENHADOEXERCICIO:big,LIQUIDADO_EXERCICIO:big,PAGO_EXERCICIO:big,SALDO_ORCAMENTARIO:'0',SALDO_A_LIQUIDAR:'0',SALDO_A_PAGAR:'0'})],[],mapping);
  assert.equal(result.accounts[0].snapshot.empenhado,900719925474099301n);
  assert.equal(result.accounts[0].diff.empenhado,0n);assert.equal(result.accounts[0].status,'match');
});

test('nulos e subcentavos API são indisponíveis; zero explícito continua zero',()=>{
  const result=reconcileSnapshot(snapshot({'6.2.1 - Conta':metrics('0','0','0','0')}),[demo({ORCADO:'0',EMPENHADOEXERCICIO:null,LIQUIDADO_EXERCICIO:'0.001',PAGO_EXERCICIO:'0',SALDO_ORCAMENTARIO:'0',SALDO_A_LIQUIDAR:null,SALDO_A_PAGAR:null})],[center({VALOR_TOTAL:null})],mapping);
  assert.equal(result.accounts[0].api.empenhado,null);assert.equal(result.accounts[0].api.liquidado,null);assert.equal(result.accounts[0].api.pago,0n);
  assert.equal(result.accounts[0].status,'invalid');assert.equal(result.totals.api.empenhado,null);
  assert.equal(result.centers[0].executionDiff,null);assert.equal(result.centers[0].status,'invalid');
  assert.ok(result.accounts[0].flags.some(f=>f.code==='missing_or_invalid_money'));
});

test('respostas vazias e códigos ausentes não viram valores zero nem junções por nome',()=>{
  const result=reconcileSnapshot(snapshot(),[],[],mapping);
  assert.equal(result.accounts[0].status,'missing_api');assert.equal(result.accounts[0].api,null);
  assert.equal(result.totals.api.empenhado,null);assert.equal(result.totals.centersApiTotal,null);
  const unknown=reconcileSnapshot(snapshot({'Nome API diferente':metrics()}),[demo()],[center()],mapping);
  assert.equal(unknown.accounts[0].status,'missing_snapshot');assert.equal(unknown.totals.snapshotComplete,false);
  assert.equal(unknown.totals.snapshot.empenhado,null);
  assert.ok(unknown.centers[0].flags.some(f=>f.code==='missing_account_code'));
});

test('duplicatas analíticas no demonstrativo são sinalizadas e não somadas',()=>{
  const result=reconcileSnapshot(snapshot(),[demo(),demo()],[],mapping);
  assert.equal(result.accounts[0].status,'duplicate');assert.equal(result.accounts[0].api.empenhado,null);
  assert.equal(result.totals.api.empenhado,null);assert.equal(result.totals.apiComplete,false);
});

test('mesmo código repetido no mesmo centro histórico é ambíguo, não uma soma legítima',()=>{
  const result=reconcileSnapshot(snapshot({'6.2.1 - Primeiro':metrics(),'6.2.1 - Segundo':metrics()}),[demo()],[center()],mapping);
  assert.equal(result.accounts[0].status,'duplicate');assert.equal(result.accounts[0].snapshot.empenhado,null);
  assert.equal(result.totals.snapshot.empenhado,null);
  assert.equal(result.centers[0].status,'duplicate');
});

test('duplicata centro/conta na API impede soma e diferença falsa',()=>{
  const result=reconcileSnapshot(snapshot(),[demo()],[center(),center()],mapping);
  assert.equal(result.centers[0].status,'duplicate');assert.equal(result.centers[0].api.candidateEmpenhado,null);
  assert.equal(result.centers[0].executionDiff,null);assert.equal(result.centers[0].accounts[0].status,'duplicate');
  assert.equal(result.totals.centersApiTotal,null);
});

test('centro ausente com execução zero preserva orçamento positivo e diferenças mantêm sinal',()=>{
  const s=snapshot();s.centros['02 - CENTRO B']={contas:{'6.2.1 - Sem execução':metrics('0','0','0','1000')}};
  const result=reconcileSnapshot(s,[demo({ORCADO:'1100',SALDO_ORCAMENTARIO:'1090'})],[center({VALOR_TOTAL:'12'})],mapping);
  const absent=result.centers.find(row=>row.code==='1.02');
  assert.equal(absent.status,'missing_api');assert.equal(absent.snapshot.orcado,100000n);assert.equal(absent.api,null);
  assert.ok(absent.flags.some(f=>f.code==='budget_without_api_execution'));
  assert.equal(result.counts.centersAbsentWithBudget,1);
  assert.equal(result.centers.find(row=>row.code==='1.01').executionDiff,200n);
  assert.equal(result.totals.centersCandidateDiff,200n);
});

test('diferenças de contas, totais e centros usam uniformemente API menos retrato',()=>{
  const result=reconcileSnapshot(snapshot(),[demo({ORCADO:'110',EMPENHADOEXERCICIO:'12',LIQUIDADO_EXERCICIO:'7',PAGO_EXERCICIO:'4',SALDO_ORCAMENTARIO:'98',SALDO_A_LIQUIDAR:'5',SALDO_A_PAGAR:'3'})],[center({VALOR_TOTAL:'12'})],mapping);
  const expected={orcado:1000n,empenhado:200n,liquidado:200n,pago:100n,saldoOrc:800n,saldoLiq:0n,saldoPagar:100n};
  assert.deepEqual(result.accounts[0].diff,expected);
  assert.deepEqual(result.totals.diff,expected);
  assert.equal(result.centers[0].executionDiff,200n);
  assert.equal(result.totals.centersCandidateDiff,200n);
  assert.equal(result.comparisonRule,'api_minus_snapshot');
  const reduced=reconcileSnapshot(snapshot(),[demo({EMPENHADOEXERCICIO:'9'})],[center({VALOR_TOTAL:'9'})],mapping);
  assert.equal(reduced.accounts[0].diff.empenhado,-100n);
  assert.equal(reduced.totals.diff.empenhado,-100n);
  assert.equal(reduced.centers[0].executionDiff,-100n);
});

test('conta histórica sem código impede subtotal parcial no centro e no total geral',()=>{
  const s=snapshot({'6.2.1 - Válida':metrics(),'Conta sem código':metrics('100','50','30','900')});
  const result=reconcileSnapshot(s,[demo()],[center()],mapping);
  assert.equal(result.totals.snapshotComplete,false);
  for(const value of Object.values(result.totals.snapshot))assert.equal(value,null);
  for(const value of Object.values(result.centers[0].snapshot))assert.equal(value,null);
  assert.equal(result.centers[0].status,'invalid');
  assert.equal(result.centers[0].executionDiff,null);
  assert.ok(result.centers[0].flags.some(item=>item.code==='missing_account_code'));
});

test('conta sem código na API impede apresentar soma parcial daquele centro',()=>{
  const result=reconcileSnapshot(snapshot(),[demo()],[center(),center({CODIGO_CONTA:null,VALOR_TOTAL:'100'})],mapping);
  assert.equal(result.centers[0].api.candidateEmpenhado,null);
  assert.equal(result.centers[0].api.monthly.JUN,null);
  assert.equal(result.centers[0].executionDiff,null);
  assert.equal(result.centers[0].status,'invalid');
  assert.equal(result.totals.centersApiTotal,null);
  assert.equal(result.totals.centerExecutionComplete,false);
});

function decodeFirestore(node){
  if('mapValue'in node)return Object.fromEntries(Object.entries(node.mapValue.fields||{}).map(([key,value])=>[key,decodeFirestore(value)]));
  if('arrayValue'in node)return(node.arrayValue.values||[]).map(decodeFirestore);
  if('nullValue'in node)return null;
  for(const key of ['doubleValue','integerValue','stringValue','booleanValue','timestampValue'])if(key in node)return node[key];
  throw new Error('Tipo Firestore desconhecido.');
}

test('auditoria privada confirma 105 contas, 27 centros iguais, 8 divergentes e 30 ausentes',{skip:process.env.IMPLANTA_RECONCILIATION_FIXTURE_DIR?false:'Evidências privadas ausentes: informe IMPLANTA_RECONCILIATION_FIXTURE_DIR.'},async()=>{
  const dir=process.env.IMPLANTA_RECONCILIATION_FIXTURE_DIR;
  const audit=parseExactJson(await readFile(path.join(dir,'firebase-audit.json'),'utf8'));
  const s=decodeFirestore({mapValue:{fields:audit.juneSnapshot.fields}});
  const d=parseExactJson(await readFile(path.join(dir,'implanta-review-evidence/demonstrativo-jun2026-offline.json'),'utf8'));
  const c=parseExactJson(await readFile(path.join(dir,'implanta-review-evidence/centros-jan-jun2026.json'),'utf8'));
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const actualMap={};
  for(const match of app.matchAll(/'([^']+)': \{ seq: (\d+), nomeFinal: '(.*)' \}/g))actualMap[match[1]]={seq:Number(match[2]),nomeFinal:match[3]};
  const result=reconcileSnapshot(s,d,c,actualMap);
  assert.equal(result.counts.accounts,105);assert.equal(result.counts.accountsMatched,105);
  assert.equal(result.counts.centers,65);assert.equal(result.counts.centersMatched,27);assert.equal(result.counts.centersDifferent,8);
  assert.equal(result.counts.centersAbsentFromApi,30);assert.equal(result.counts.centersAbsentWithBudget,30);
  assert.equal(result.totals.snapshot.empenhado,1459982897n);assert.equal(result.totals.api.empenhado,1459982897n);
  assert.equal(result.totals.snapshot.orcado,2767936760n);assert.equal(result.totals.api.orcado,2767936760n);
  assert.equal(result.totals.centersApiTotal,1463176978n);assert.equal(result.totals.centersCandidateDiff,3194081n);
  for(const amount of Object.values(result.totals.diff))assert.equal(amount,0n);
});
