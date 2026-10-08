import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const from=source.indexOf(start);assert.ok(from>=0,start);const to=end?source.indexOf(end,from):source.length;assert.ok(to>from,end);return source.slice(from,to);}
const utilities=section('function stripAccents','// ---------- Firestore: snapshots');
const basic=vm.createContext({});vm.runInContext(utilities,basic);

test('Shared formatter always includes BRL, grouping and two fractional digits',()=>{
 for(const [value,expected]of [[0,'R$ 0,00'],[-0,'R$ 0,00'],[1,'R$ 1,00'],[1234.56,'R$ 1.234,56'],[-1234.56,'R$ -1.234,56'],[1234567.8,'R$ 1.234.567,80'],[1.005,'R$ 1,01'],[-0.001,'R$ 0,00']])assert.equal(basic.fmt(value),expected);
 for(const missing of [null,undefined,NaN,Infinity,-Infinity,'1234.56','',true])assert.equal(basic.fmt(missing),'—');
});

test('Study deltas place signs after the same currency prefix and normalize rounded zero',()=>{
 assert.equal(basic.fmtSigned(1234.56),'R$ +1.234,56');assert.equal(basic.fmtSigned(-1234.56),'R$ -1.234,56');
 assert.equal(basic.fmtSigned(0),'R$ 0,00');assert.equal(basic.fmtSigned(0.001),'R$ 0,00');assert.equal(basic.fmtSigned(-0.001),'R$ 0,00');assert.equal(basic.fmtSigned(NaN),'—');
});

function renderer(){
 const nodes={currentCard:{innerHTML:'',querySelectorAll:()=>[]},categorySummaryCard:{innerHTML:''},studiesContent:{innerHTML:''},studyFrom:{value:'2026-06-30',addEventListener(){}},studyTo:{value:'2026-07-31',addEventListener(){}}};
 const previous={date:'2026-06-30',rows:[{centro:'Centro',orcado:10000,empenho:4000,liquidacao:3000,pagamento:2000,saldoOrc:6000,saldoLiq:1000,saldoPagar:1000}],origem:{formato:'pdf',coluna:'na_data',parserVersion:4}};
 const current={date:'2026-07-31',rows:[{centro:'Centro',orcado:10000,empenho:5234.56,liquidacao:3000,pagamento:1999,saldoOrc:4765.44,saldoLiq:2234.56,saldoPagar:1001}],origem:{formato:'pdf',coluna:'na_data',parserVersion:4}};
 const detail={innerHTML:'',querySelectorAll:()=>[]};
 const ctx=vm.createContext({document:{getElementById:id=>nodes[id]},
  rowsFromSnapshot:s=>s.rows,visibleRows:s=>s.rows,selectedCategories:['Categoria'],categoryNames:()=>['Categoria'],filterBusca:{value:''},balanceOrder:{value:'name'},catState:{map:{Centro:'Categoria'},colors:{}},
  escHtml:String,safeHexColor:(value,fallback)=>fallback,currentRole:'viewer',nomeExibicaoConta:String,detalheCentroCard:detail,
  lastCurrentSnap:current,availableDates:[previous.date,current.date],snapshotsByDate:{[previous.date]:previous,[current.date]:current},passesFilter:()=>true
 });
 vm.runInContext(utilities,ctx);
 vm.runInContext(section('var currentCard','// ---------- resumo por categoria ----------'),ctx);
 vm.runInContext(section('var categorySummaryCard','// ---------- retratos (upload)'),ctx);
 vm.runInContext(section('function renderDetalheCentro','// ---------- minha conta ----------'),ctx);
 vm.runInContext(section('var studyFrom'),ctx);
 return{ctx,nodes,current,detail};
}

test('Cards, category summary, account detail and studies display currencies once',()=>{
 const {ctx,nodes,current,detail}=renderer();ctx.renderCurrent(current);ctx.renderCategorySummary(current);
 ctx.renderDetalheCentro({subtotal:{Orc_Desbloq:4765.44,Empenhado:5234.56,Liquidado:3000,Pago:1999},contas:{Conta:{Orc_Desbloq:4765.44,Empenhado:5234.56,Liquidado:3000,Pago:1999}}});ctx.renderStudies();
 for(const [name,node]of [['cards',nodes.currentCard],['summary',nodes.categorySummaryCard],['detail',detail],['studies',nodes.studiesContent]]){
  assert.ok(node.innerHTML.includes('R$ 5.234,56'),name+' must show currency and grouping');assert.ok(!/R\$\s*R\$/.test(node.innerHTML),name+' must not duplicate BRL');assert.ok(!/R\$\s*[\d.,]+%/.test(node.innerHTML),name+' must not label a percentage as currency');
 }
 assert.ok(nodes.categorySummaryCard.innerHTML.includes('<td>R$ 4.765,44</td>'));
 assert.ok(nodes.studiesContent.innerHTML.includes('R$ +1.234,56'));assert.ok(nodes.studiesContent.innerHTML.includes('R$ -1,00'));assert.ok(nodes.studiesContent.innerHTML.includes('R$ 0,00'));
 assert.ok(nodes.currentCard.innerHTML.includes('19.99%'));assert.equal(ctx.studyMoney(1234.56),'R$ 1.234,56');
});

test('All legacy monetary callsites delegate the currency prefix to the formatter',()=>{
 assert.ok(!/R\$ '\+fmt\(/.test(source),'Manual prefixes would duplicate the shared formatter in upload/cards/detail');
 assert.ok(!/return 'R\$ '\+fmt\(/.test(source),'studyMoney must not add another prefix');
});
