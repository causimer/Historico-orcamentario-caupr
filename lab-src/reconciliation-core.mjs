import {cents, flattenRows} from './implanta-core.mjs';

const RECON_STAGES = Object.freeze(['orcado','empenhado','liquidado','pago','saldoOrc','saldoLiq','saldoPagar']);
const RECON_DEMO_FIELDS = Object.freeze({orcado:'ORCADO',empenhado:'EMPENHADOEXERCICIO',liquidado:'LIQUIDADO_EXERCICIO',pago:'PAGO_EXERCICIO',saldoOrc:'SALDO_ORCAMENTARIO',saldoLiq:'SALDO_A_LIQUIDAR',saldoPagar:'SALDO_A_PAGAR'});
const RECON_MONTHS = Object.freeze('JAN FEV MAR ABR MAI JUN JUL AGO SET OUT NOV DEZ'.split(' '));
const RECON_DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const RECON_ACCOUNT_CODE = /^\d+(?:\.\d+)+$/;
const reconZeroMetrics = () => Object.fromEntries(RECON_STAGES.map(key=>[key,0n]));
const reconNullMetrics = () => Object.fromEntries(RECON_STAGES.map(key=>[key,null]));
const reconAdd = (a,b) => a===null || b===null ? null : a+b;
const reconSubtract = (a,b) => a===null || b===null ? null : a-b;
const reconFlag = (code,message,details={}) => ({code,message,...details});

/** Importações históricas usam arredondamento decimal explícito a centavos,
 * metade para longe de zero. Um Number não finito ou sem precisão mínima é
 * indisponível; a API continua usando cents(), que rejeita subcentavos. */
export function snapshotCents(value) {
  if (typeof value==='bigint') return value;
  if (typeof value==='number') {
    if (!Number.isFinite(value) || Math.abs(value)>Number.MAX_SAFE_INTEGER/100) return null;
    value=String(value);
  }
  if (typeof value!=='string' || value.length>1024) return null;
  const match=RECON_DECIMAL.exec(value);
  if (!match) return null;
  const fraction=match[3]||'', exponent=Number(match[4]||0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent)>500) return null;
  const coefficient=BigInt(match[2]+fraction),scale=2+exponent-fraction.length;
  let result;
  if (scale>=0) result=coefficient*10n**BigInt(scale);
  else {
    const divisor=10n**BigInt(-scale);
    result=coefficient/divisor;
    if (coefficient%divisor*2n>=divisor) result++;
  }
  return match[1] ? -result : result;
}

function reconAccountCode(value, label=false) {
  if (typeof value!=='string') return null;
  if (!label) return RECON_ACCOUNT_CODE.test(value) ? value : null;
  return /^(\d+(?:\.\d+)+)(?=\s|$|[-–—])/.exec(value)?.[1]||null;
}

function reconMoney(value, historical, flags, field) {
  const result=historical ? snapshotCents(value) : cents(value);
  if (result===null) flags.push(reconFlag('missing_or_invalid_money','Valor ausente ou inválido; não foi convertido em zero.',{field,raw:value??null}));
  else if (historical && cents(typeof value==='number'?String(value):value)===null) flags.push(reconFlag('historical_rounding','Resíduo da importação histórica arredondado explicitamente para duas casas.',{field,raw:value,roundedCents:result}));
  return result;
}

function reconSnapshotMetrics(values, flags) {
  const empenhado=reconMoney(values?.Empenhado,true,flags,'Empenhado');
  const liquidado=reconMoney(values?.Liquidado,true,flags,'Liquidado');
  const pago=reconMoney(values?.Pago,true,flags,'Pago');
  const saldoOrc=reconMoney(values?.Orc_Desbloq,true,flags,'Orc_Desbloq');
  return {orcado:reconAdd(saldoOrc,empenhado),empenhado,liquidado,pago,saldoOrc,saldoLiq:reconSubtract(empenhado,liquidado),saldoPagar:reconSubtract(liquidado,pago)};
}

function reconApiMetrics(row,flags) {
  return Object.fromEntries(RECON_STAGES.map(key=>[key,reconMoney(row[RECON_DEMO_FIELDS[key]],false,flags,RECON_DEMO_FIELDS[key])]));
}

function reconAggregate(items, field) {
  const result=reconZeroMetrics();
  for (const item of items) for (const key of RECON_STAGES) result[key]=reconAdd(result[key],item[field]?.[key]??null);
  return result;
}

function reconDifferences(snapshot,api) {
  return Object.fromEntries(RECON_STAGES.map(key=>[key,reconSubtract(api?.[key]??null,snapshot?.[key]??null)]));
}

function reconCompareStatus(snapshot,api,diff,flags) {
  if (flags.some(f=>f.code==='duplicate')) return 'duplicate';
  if (!snapshot) return 'missing_snapshot';
  if (!api) return 'missing_api';
  if (RECON_STAGES.some(key=>diff[key]===null)) return 'invalid';
  return RECON_STAGES.every(key=>diff[key]===0n) ? 'match' : 'difference';
}

/** Reconcile um retrato já decodificado, respostas parseExactJson e mapa anual.
 * Valores financeiros: BigInt centavos ou null. Todas as diferenças usam
 * API menos retrato, inclusive diff de contas/totais e executionDiff de centros.
 * Centers.api.candidateEmpenhado é somente candidato, nunca dotação oficial.
 * O chamador deve assegurar referências iguais: os arrays não contêm os
 * parâmetros de coleta necessários para provar o recorte temporal.
 */
export function reconcileSnapshot(snapshot,demo,centers,centerMap) {
  if (!snapshot || typeof snapshot!=='object' || !snapshot.centros || Array.isArray(snapshot.centros)) throw new TypeError('Informe um retrato com centros e contas já decodificados.');
  if (!Array.isArray(demo) || !Array.isArray(centers)) throw new TypeError('As respostas da API precisam ser listas.');
  const mapping=typeof centerMap==='function' ? centerMap() : centerMap;
  if (!mapping || typeof mapping!=='object') throw new TypeError('Informe o mapeamento de códigos de centros.');
  const flags=[reconFlag('snapshot_rounding_policy','Valores históricos são arredondados explicitamente a centavos; contas da API preservam os tokens exatos.')];
  const labels=new Map(),ambiguousLabels=new Set();
  for (const [code,entry] of Object.entries(mapping)) {
    if (!entry || !Number.isInteger(Number(entry.seq)) || typeof entry.nomeFinal!=='string') continue;
    const label=String(entry.seq).padStart(2,'0')+' - '+entry.nomeFinal;
    if (labels.has(label)) ambiguousLabels.add(label);
    else labels.set(label,code);
  }
  const snapshotAccounts=new Map(),snapshotCenters=new Map();
  let invalidSnapshotCode=false;
  for (const [label,center] of Object.entries(snapshot.centros)) {
    const centerFlags=[],lines=[],counts=new Map();
    const code=ambiguousLabels.has(label) ? null : labels.get(label)||reconAccountCode(label,true);
    if (!code) centerFlags.push(reconFlag('unmapped_snapshot_center','Centro do retrato sem código correspondente no mapa anual.',{label}));
    if (ambiguousLabels.has(label)) centerFlags.push(reconFlag('duplicate','Mais de um código de centro gera o mesmo rótulo no mapa.',{label}));
    if (!center?.contas || typeof center.contas!=='object' || Array.isArray(center.contas) || Object.keys(center.contas).length===0) {
      centerFlags.push(reconFlag('missing_accounts','O centro não contém contas válidas; subtotal não usado como substituto.'));
      invalidSnapshotCode=true;
    } else for (const [name,values] of Object.entries(center.contas)) {
      const lineFlags=[],codeAccount=reconAccountCode(name,true),metrics=reconSnapshotMetrics(values,lineFlags);
      if (!codeAccount) {
        centerFlags.push(reconFlag('missing_account_code','Conta do retrato não possui prefixo contábil validável; nenhuma junção por nome foi feita.',{name}));
        invalidSnapshotCode=true;
        continue;
      }
      const line={code:codeAccount,name,snapshot:metrics,flags:lineFlags,centerCode:code,centerLabel:label};
      lines.push(line);counts.set(codeAccount,(counts.get(codeAccount)||0)+1);
    }
    for (const line of lines) {
      if (counts.get(line.code)>1) {
        line.flags.push(reconFlag('duplicate','Código contábil repetido dentro do mesmo centro do retrato.',{accountCode:line.code}));
        line.snapshot=reconNullMetrics();
      }
      if (!snapshotAccounts.has(line.code)) snapshotAccounts.set(line.code,[]);
      snapshotAccounts.get(line.code).push(line);
    }
    const metrics=centerFlags.some(f=>['missing_accounts','missing_account_code','duplicate'].includes(f.code)) ? reconNullMetrics() : reconAggregate(lines,'snapshot');
    const entry={code,label,name:label.includes(' - ')?label.slice(label.indexOf(' - ')+3):label,snapshot:metrics,flags:centerFlags,lines};
    snapshotCenters.set(code||'unmapped:'+label,entry);
  }

  const demoAccounts=new Map();
  let invalidDemoCode=false;
  for (const entry of flattenRows(demo)) {
    const row=entry.row;
    if (row.ANALITICA===false) continue;
    if (row.ANALITICA!==true) {flags.push(reconFlag('invalid_analytic_flag','Registro do demonstrativo sem marcação analítica válida foi excluído.',{path:entry.path}));invalidDemoCode=true;continue;}
    const code=reconAccountCode(row.CONTA_CODIGO)||reconAccountCode(row.CODIGO),rowFlags=[];
    if (!code) {flags.push(reconFlag('missing_account_code','Conta analítica da API sem código validável foi excluída.',{path:entry.path}));invalidDemoCode=true;continue;}
    const metrics=reconApiMetrics(row,rowFlags);
    if (!demoAccounts.has(code)) demoAccounts.set(code,[]);
    demoAccounts.get(code).push({code,name:row.CONTA_NOME||row.NOME||code,api:metrics,flags:rowFlags,path:entry.path,raw:row});
  }
  const accounts=[];
  for (const code of new Set([...snapshotAccounts.keys(),...demoAccounts.keys()])) {
    const snapshotLines=snapshotAccounts.get(code)||[],apiLines=demoAccounts.get(code)||[];
    const rowFlags=snapshotLines.flatMap(line=>line.flags).concat(apiLines.flatMap(line=>line.flags));
    if (apiLines.length>1) rowFlags.push(reconFlag('duplicate','Mais de uma conta analítica da API usa o mesmo código; valores não foram somados.',{accountCode:code,count:apiLines.length}));
    const s=snapshotLines.length?reconAggregate(snapshotLines,'snapshot'):null;
    const a=apiLines.length===1?apiLines[0].api:apiLines.length?reconNullMetrics():null;
    const diff=reconDifferences(s,a);
    accounts.push({code,name:apiLines[0]?.name||snapshotLines[0]?.name||code,snapshot:s,api:a,diff,status:reconCompareStatus(s,a,diff,rowFlags),flags:rowFlags,snapshotCentres:snapshotLines.map(line=>({code:line.centerCode,label:line.centerLabel})),demoPaths:apiLines.map(line=>line.path)});
  }
  accounts.sort((a,b)=>a.code.localeCompare(b.code,'pt-BR',{numeric:true}));

  const apiCenters=new Map(),invalidApiCenters=new Map();
  let invalidCenterCode=false;
  centers.forEach((row,index)=>{
    if (!row || typeof row!=='object' || Array.isArray(row)) {flags.push(reconFlag('invalid_center_record','Linha de centros inválida foi excluída.',{index}));invalidCenterCode=true;return;}
    if (row.ANALITICO===false) return;
    if (row.ANALITICO!==true) {flags.push(reconFlag('invalid_analytic_flag','Linha de centros sem marcação analítica válida foi excluída.',{index}));invalidCenterCode=true;return;}
    const code=row.CODIGO_CENTRO_CUSTO,codeAccount=reconAccountCode(row.CODIGO_CONTA);
    if (typeof code!=='string' || !code || !codeAccount) {
      const problem=reconFlag('missing_center_or_account_code','Linha de centros sem códigos válidos foi excluída; subtotal parcial não foi utilizado.',{index});
      flags.push(problem);invalidCenterCode=true;
      if (typeof code==='string' && code) {
        if (!apiCenters.has(code)) apiCenters.set(code,[]);
        if (!invalidApiCenters.has(code)) invalidApiCenters.set(code,[]);
        invalidApiCenters.get(code).push(problem);
      }
      return;
    }
    const rowFlags=[],value=reconMoney(row.VALOR_TOTAL,false,rowFlags,'VALOR_TOTAL');
    const monthly=Object.fromEntries(RECON_MONTHS.map(month=>[month,reconMoney(row['VALOR_'+month],false,rowFlags,'VALOR_'+month)]));
    const reportedOrcamento=reconMoney(row.ORCAMENTO,false,rowFlags,'ORCAMENTO');
    const reportedSaldo=reconMoney(row.SALDO,false,rowFlags,'SALDO');
    if (!apiCenters.has(code)) apiCenters.set(code,[]);
    apiCenters.get(code).push({code:codeAccount,name:row.NOME_CONTA||codeAccount,value,monthly,reportedOrcamento,reportedSaldo,flags:rowFlags,raw:row,index});
  });

  const centerRows=[];
  for (const key of new Set([...snapshotCenters.keys(),...apiCenters.keys()])) {
    const historical=snapshotCenters.get(key),source=apiCenters.get(key)||[],invalidSource=invalidApiCenters.has(key),centerFlags=[...(historical?.flags||[]),...(historical?.lines||[]).flatMap(line=>line.flags),...source.flatMap(line=>line.flags),...(invalidApiCenters.get(key)||[])];
    const mapEntry=Object.hasOwn(mapping,key)?mapping[key]:null;
    const label=historical?.label || (mapEntry ? String(mapEntry.seq).padStart(2,'0')+' - '+mapEntry.nomeFinal : key+' - '+(source[0]?.raw.NOME_CENTRO_CUSTO||''));
    if (source.length && !mapEntry) centerFlags.push(reconFlag('unmapped_api_center','Código de centro da API não consta no mapa anual; junção por nome não foi feita.',{centerCode:key}));
    const repeated=new Set();
    const keyCounts=new Map();source.forEach(line=>keyCounts.set(line.code,(keyCounts.get(line.code)||0)+1));
    for (const [code,count] of keyCounts) if(count>1) {repeated.add(code);centerFlags.push(reconFlag('duplicate','Combinação centro e conta repetida na API; não foi somada.',{accountCode:code,count}));}
    let api=null;
    if (source.length || invalidSource) {
      const sumField=(field)=>invalidSource?null:source.reduce((sum,line)=>reconAdd(sum,repeated.has(line.code)?null:line[field]),0n);
      api={candidateEmpenhado:sumField('value'),monthly:Object.fromEntries(RECON_MONTHS.map(month=>[month,invalidSource?null:source.reduce((sum,line)=>reconAdd(sum,repeated.has(line.code)?null:line.monthly[month]),0n)])),reportedOrcamento:sumField('reportedOrcamento'),reportedSaldo:sumField('reportedSaldo'),budgetReportedZero:!invalidSource && source.every(line=>line.reportedOrcamento===0n),stageConfirmed:false};
      centerFlags.push(reconFlag('unconfirmed_center_stage','VALOR_TOTAL é comparado como candidato a empenhado; o estágio ainda não foi confirmado na fonte.'));
      if (api.budgetReportedZero) centerFlags.push(reconFlag('api_budget_zero_not_used','ORCAMENTO da API veio zerado e não foi utilizado como dotação do centro.'));
    }
    const s=historical?.snapshot||null,difference=reconSubtract(api?.candidateEmpenhado??null,s?.empenhado??null);
    let status=centerFlags.some(f=>f.code==='duplicate')?'duplicate':!s?'missing_snapshot':!api?'missing_api':difference===null?'invalid':difference===0n?'match':'difference';
    if (!api && s?.empenhado===0n && s?.liquidado===0n && s?.pago===0n && s?.orcado>0n) centerFlags.push(reconFlag('budget_without_api_execution','Centro ausente na API de execução possui orçamento positivo no retrato; não foi tratado como orçamento zero.'));
    const lineAccounts=[];
    const historicalByCode=new Map((historical?.lines||[]).map(line=>[line.code,line]));
    const sourceByCode=new Map(source.map(line=>[line.code,line]));
    for (const code of new Set([...historicalByCode.keys(),...sourceByCode.keys()])) {
      const hs=historicalByCode.get(code),ar=sourceByCode.get(code),lineFlags=[...(hs?.flags||[]),...(ar?.flags||[])];
      if (repeated.has(code)) lineFlags.push(reconFlag('duplicate','Combinação centro e conta repetida na API.'));
      const candidate=repeated.has(code)?null:ar?.value??null;
      const executionDiff=reconSubtract(candidate,hs?.snapshot.empenhado??null);
      const lineStatus=lineFlags.some(f=>f.code==='duplicate')?'duplicate':!hs?'missing_snapshot':!ar?'missing_api':executionDiff===null?'invalid':executionDiff===0n?'match':'difference';
      lineAccounts.push({code,name:ar?.name||hs?.name||code,snapshot:hs?.snapshot||null,apiCandidate:candidate,executionDiff,status:lineStatus,flags:lineFlags});
    }
    lineAccounts.sort((a,b)=>a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
    centerRows.push({id:key,code:historical?historical.code:key,label,name:historical?.name||mapEntry?.nomeFinal||source[0]?.raw.NOME_CENTRO_CUSTO||label,snapshot:s,api,executionDiff:difference,status,flags:centerFlags,accounts:lineAccounts});
  }
  centerRows.sort((a,b)=>a.label.localeCompare(b.label,'pt-BR',{numeric:true}));
  const totalSnapshot=invalidSnapshotCode || snapshotAccounts.size===0?reconNullMetrics():reconAggregate(accounts.filter(row=>row.snapshot),'snapshot');
  const totalApi=invalidDemoCode || demoAccounts.size===0?reconNullMetrics():reconAggregate(accounts.filter(row=>row.api),'api');
  const centersApiTotal=invalidCenterCode || apiCenters.size===0?null:centerRows.filter(row=>row.api).reduce((sum,row)=>reconAdd(sum,row.api.candidateEmpenhado),0n);
  const counts={accounts:accounts.length,accountsMatched:accounts.filter(row=>row.status==='match').length,accountsDifferent:accounts.filter(row=>row.status==='difference').length,centers:centerRows.length,centersMatched:centerRows.filter(row=>row.status==='match').length,centersDifferent:centerRows.filter(row=>row.status==='difference').length,centersAbsentFromApi:centerRows.filter(row=>row.status==='missing_api').length,centersAbsentFromSnapshot:centerRows.filter(row=>row.status==='missing_snapshot').length,centersAbsentWithBudget:centerRows.filter(row=>row.flags.some(f=>f.code==='budget_without_api_execution')).length};
  const totals={snapshot:totalSnapshot,api:totalApi,diff:reconDifferences(totalSnapshot,totalApi),centersApiTotal,centersCandidateDiff:reconSubtract(centersApiTotal,totalSnapshot.empenhado),snapshotComplete:!invalidSnapshotCode && RECON_STAGES.every(key=>totalSnapshot[key]!==null),apiComplete:!invalidDemoCode && RECON_STAGES.every(key=>totalApi[key]!==null),centerExecutionComplete:!invalidCenterCode && centersApiTotal!==null};
  if (centerRows.some(row=>row.api?.budgetReportedZero)) flags.push(reconFlag('api_budget_zero_not_used','Dotação do retrato é preservada; orçamento zero na API de centros não substitui o orçamento importado.'));
  return {accounts,centers:centerRows,totals,counts,flags,reference:snapshot.date||null,comparisonRule:'api_minus_snapshot'};
}
