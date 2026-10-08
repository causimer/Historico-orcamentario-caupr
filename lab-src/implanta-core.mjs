// A leitura preserva os tokens monetários da origem como texto. Cálculos usam
// centavos BigInt; valores ausentes ou com frações de centavo permanecem inválidos.
export const IMPLANTA_BASE = 'https://cau-pr.implanta.net.br/portalTransparencia/api/v1.0/';
export const MAX_RESPONSE_BYTES = 20_000_000;
export const COLLECTION_TIMEOUT_MS = 60_000;
const MONEY_NUMBER = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const SOURCE_MODES = Object.freeze({
  Balancete: 'month', BalancoFinanceiro: 'month', BalancoOrcamentario: 'month',
  BalancoPatrimonial: 'month', ComparativoReceita: 'month', ComparativoDespesa: 'month',
  FluxoCaixa: 'month', ExecucaoFinanceira: 'day', PlanoDeContas: 'year',
  VariacoesPatrimoniais: 'month', DemonstrativoEmpenhosPagamentos: 'month',
  DespesasCentroCusto: 'month'
});

/** JSON válido, com todos os números mantidos como seus tokens de texto exatos. */
export function parseExactJson(input) {
  if (typeof input !== 'string') throw new TypeError('O JSON precisa ser texto.');
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let at = 0;
  const bad = () => { throw new SyntaxError('JSON inválido na posição ' + at + '.'); };
  const space = () => { while (/[\u0020\t\r\n]/.test(source[at] || '\0')) at++; };
  const string = () => {
    if (source[at] !== '"') return bad();
    const start = at++;
    let escaped = false;
    while (at < source.length) {
      const char = source[at++];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') return JSON.parse(source.slice(start, at));
    }
    return bad();
  };
  const value = (depth) => {
    if (depth > 300) throw new RangeError('JSON excede a profundidade segura de leitura.');
    space();
    const char = source[at];
    if (char === '"') return string();
    if (char === '{') {
      const object = {};
      at++; space();
      if (source[at] === '}') { at++; return object; }
      while (true) {
        space();
        const key = string();
        space();
        if (source[at++] !== ':') return bad();
        const result = value(depth + 1);
        Object.defineProperty(object, key, {value: result, enumerable: true, configurable: true, writable: true});
        space();
        if (source[at] === '}') { at++; return object; }
        if (source[at++] !== ',') return bad();
      }
    }
    if (char === '[') {
      const array = [];
      at++; space();
      if (source[at] === ']') { at++; return array; }
      while (true) {
        array.push(value(depth + 1));
        space();
        if (source[at] === ']') { at++; return array; }
        if (source[at++] !== ',') return bad();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, at)) { at += literal.length; return result; }
    }
    JSON_NUMBER.lastIndex = at;
    const match = JSON_NUMBER.exec(source);
    if (!match) return bad();
    at = JSON_NUMBER.lastIndex;
    return match[0];
  };
  const result = value(0);
  space();
  if (at !== source.length) return bad();
  return result;
}

/** Texto em reais -> centavos exatos. BigInt já representa centavos. */
export function cents(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || value.length > 1024) return null;
  const match = MONEY_NUMBER.exec(value);
  if (!match) return null;
  const fraction = match[3] || '';
  const exponent = match[4] ? Number(match[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 500) return null;
  const coefficient = BigInt(match[2] + fraction);
  const scale = 2 + exponent - fraction.length;
  let result;
  if (scale >= 0) result = coefficient * 10n ** BigInt(scale);
  else {
    const divisor = 10n ** BigInt(-scale);
    if (coefficient % divisor !== 0n) return null;
    result = coefficient / divisor;
  }
  return match[1] ? -result : result;
}

/** Formatação brasileira sem converter dinheiro para Number. */
export function formatMoney(value) {
  const exact = cents(value);
  if (exact === null) return 'Indisponível';
  const absolute = exact < 0n ? -exact : exact;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return (exact < 0n ? 'R$ -' : 'R$ ') + whole + ',' + fraction;
}

function validYear(value) {
  const text = String(value ?? '');
  if (!/^\d{4}$/.test(text) || text < '1900' || text > '9999') throw new Error('Informe um exercício válido com quatro dígitos.');
  return text;
}

function dayParts(value) {
  if (typeof value !== 'string') throw new Error('Informe uma data válida.');
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const official = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!iso && !official) throw new Error('Use uma data no formato AAAA-MM-DD.');
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : [official[3], official[2], official[1]];
  validYear(year);
  const m = Number(month), d = Number(day), y = Number(year);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > lengths[m - 1]) throw new Error('A data não existe no calendário.');
  return {key: `${year}-${month}-${day}`, official: `${day}/${month}/${year}`, year, month};
}

function monthParts(value) {
  if (typeof value !== 'string') throw new Error('Informe uma referência mensal válida.');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = dayParts(value);
    return {key: `${day.year}-${day.month}`, official: `${day.month}/${day.year}`};
  }
  const iso = /^(\d{4})-(\d{2})$/.exec(value);
  const official = /^(\d{2})\/(\d{4})$/.exec(value);
  if (!iso && !official) throw new Error('Use uma referência AAAA-MM ou uma data AAAA-MM-DD.');
  const year = validYear(iso ? iso[1] : official[2]);
  const month = iso ? iso[2] : official[1];
  if (Number(month) < 1 || Number(month) > 12) throw new Error('Informe um mês entre 01 e 12.');
  return {key: `${year}-${month}`, official: `${month}/${year}`};
}

/** Retorna somente URL de uma das doze operações autorizadas, com referência validada. */
export function buildQuery(endpoint, start, end, year, reportType) {
  if (!Object.hasOwn(SOURCE_MODES, endpoint)) throw new Error('Fonte não autorizada para consulta.');
  const url = new URL(IMPLANTA_BASE + endpoint);
  const mode = SOURCE_MODES[endpoint];
  if (mode === 'year') url.searchParams.set('exercicio', validYear(year));
  else {
    const first = mode === 'day' ? dayParts(start) : monthParts(start);
    const last = mode === 'day' ? dayParts(end) : monthParts(end);
    if (first.key > last.key) throw new Error('A referência inicial precisa ser anterior ou igual à final.');
    if (first.key.slice(0, 4) !== last.key.slice(0, 4)) throw new Error('Consulte um exercício por vez para preservar a interpretação do relatório.');
    url.searchParams.set('referenciaInicio', first.official);
    url.searchParams.set('referenciaTermino', last.official);
  }
  if (reportType !== undefined && reportType !== null && reportType !== '') {
    if (endpoint !== 'DemonstrativoEmpenhosPagamentos' || !['OffLine', 'OnLine'].includes(reportType)) throw new Error('Modo de relatório inválido para esta fonte.');
    url.searchParams.set('tipoRelatorio', reportType);
  }
  return url.href;
}

/** Visita as estruturas de resposta com caminho JSON; não soma pais, filhos ou contrapartidas. */
export function flattenRows(data) {
  if (!Array.isArray(data)) throw new TypeError('A resposta precisa ser uma lista de registros.');
  const rows = [];
  const seen = new WeakSet();
  const nested = ['Analiticas', 'DETALHES', 'CONTRA_PARTIDA'];
  function visit(items, path, parentPath, relation, depth) {
    if (depth > 300) throw new RangeError('Estrutura excede a profundidade segura.');
    items.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Registro inválido no caminho ' + path + '[' + index + '].');
      if (seen.has(row)) throw new TypeError('Estrutura com referência circular ou repetida.');
      seen.add(row);
      const jsonPath = `${path}[${index}]`;
      rows.push({row, path: jsonPath, jsonPath, parentPath, relation, depth});
      for (const field of nested) {
        if (row[field] == null) continue;
        if (!Array.isArray(row[field])) throw new TypeError('Lista inválida no campo ' + jsonPath + '.' + field + '.');
        visit(row[field], jsonPath + '.' + field, jsonPath, field, depth + 1);
      }
    });
  }
  visit(data, '$', null, null, 0);
  return rows;
}

function validateResponse(data) {
  flattenRows(data);
  return data;
}

/** Uma coleta de leitura, limitada em tempo e bytes, com bytes e hash para auditoria. */
export async function collect(endpoint, start, end, year, reportType, signal) {
  const url = buildQuery(endpoint, start, end, year, reportType);
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
  signal?.addEventListener('abort', forwardAbort, {once: true});
  const timer = setTimeout(() => {timedOut = true; controller.abort();}, COLLECTION_TIMEOUT_MS);
  let reader;
  try {
    const response = await fetch(url, {method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: {'Accept': 'application/json'}});
    if (!response.ok) throw new Error('A origem respondeu HTTP ' + response.status + '.');
    const contentType = response.headers.get('content-type') || '';
    if (!/^application\/(?:[a-z\d.+-]+\+)?json\b/i.test(contentType)) throw new Error('A origem não respondeu JSON.');
    const declaredLength = response.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && BigInt(declaredLength) > BigInt(MAX_RESPONSE_BYTES)) throw new Error('A resposta excede o limite de 20 MB.');
    if (!response.body?.getReader) throw new Error('Não foi possível limitar a leitura da resposta nesta sessão.');
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Formato de bytes inesperado.');
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error('A resposta excede o limite de 20 MB.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const data = validateResponse(parseExactJson(raw));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    controller.signal.throwIfAborted();
    const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    return {bytes, raw, data, url, collectedAt: new Date().toISOString(), sha256, status: response.status, contentType, recordCount: data.length};
  } catch (error) {
    if (timedOut) throw new Error('A consulta excedeu 60 segundos; isso não significa ausência de dados.');
    if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    if (reader) {try {await reader.cancel();} catch { /* Cancelamento é melhor esforço. */ } try {reader.releaseLock();} catch {}}
  }
}
