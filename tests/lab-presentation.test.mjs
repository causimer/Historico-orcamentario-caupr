import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {cents,formatMoney} from '../lab-src/implanta-core.mjs';
const source=fs.readFileSync(new URL('../lab-src/laboratory.mjs',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function scalar('),source.indexOf('const moneyLabel'));
const ctx=vm.createContext({cents,formatMoney});vm.runInContext(helpers,ctx);
test('Explorer presents financial fields from multiple accounting models with consistent BRL',()=>{
 for(const key of ['ORCADO','PAGO_EXERCICIO','SALDO','VALOR_TOTAL_ATIVO_ATUAL','EXERCICIO_ATUAL_DISPENDIOS','EXERCICIO_ANTERIOR','TOTAL_EXERCICIO','REFORMULACOES','TRANSPOSICOES','DIFERENCA'])assert.equal(ctx.displayScalar(key,'1234567.89'),'R$ 1.234.567,89',key);
 assert.equal(ctx.displayScalar('VALOR','0'),'R$ 0,00');assert.equal(ctx.displayScalar('VALOR','-1234.56'),'R$ -1.234,56');
 assert.equal(ctx.displayScalar('VALOR','1.001'),'Indisponível');assert.equal(ctx.displayScalar('VALOR','9007199254740993.01'),'R$ 9.007.199.254.740.993,01');
});
test('Codes, notification identifiers, dates and unknown values retain their own meaning',()=>{
 assert.equal(ctx.displayScalar('CODIGO','0001'),'0001');assert.equal(ctx.displayScalar('EXERCICIO','2026'),'2026');assert.equal(ctx.displayScalar('LINK_NOTIFICACAO','123'),'123');
 assert.equal(ctx.displayScalar('VALOR',null),'nulo');assert.equal(ctx.displayScalar('VALOR',undefined),'ausente');assert.equal(ctx.displayScalar('ANALITICA',true),'true');
});
