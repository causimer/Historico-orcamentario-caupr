import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAv2LqFU9nRf_FEaul0IoOiCX2vaNMHtKk",
  authDomain: "historico-orcamentario-caupr.firebaseapp.com",
  projectId: "historico-orcamentario-caupr",
  storageBucket: "historico-orcamentario-caupr.firebasestorage.app",
  messagingSenderId: "40791981660",
  appId: "1:40791981660:web:b9770067e814b0baf3f099"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;   // { uid, email }
let currentRole = null;   // 'master' | 'viewer'
var todayISO = new Date().toISOString().slice(0,10);

// ---------- elementos ----------
const loginScreen = document.getElementById('loginScreen');
const onboardScreen = document.getElementById('onboardScreen');
const appShell = document.getElementById('appShell');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const onboardMsg = document.getElementById('onboardMsg');
const sidebarUser = document.getElementById('sidebarUser');
const logoutBtn = document.getElementById('logoutBtn');

// ---------- login ----------
loginBtn.addEventListener('click', function(){
  loginError.textContent = '';
  signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value)
    .catch(function(err){ loginError.textContent = 'E-mail ou senha incorretos.'; });
});
loginPassword.addEventListener('keydown', function(e){ if (e.key === 'Enter') loginBtn.click(); });

logoutBtn.addEventListener('click', function(){ signOut(auth); });

function provisionNewUser(user){
  onboardMsg.textContent = 'Preparando sua conta...';
  return getDoc(doc(db, 'config', 'roles')).then(function(rolesSnap){
    var masterEmail = rolesSnap.exists() ? rolesSnap.data().masterEmail : null;
    var role = (masterEmail && user.email === masterEmail) ? 'master' : 'viewer';
    return setDoc(doc(db, 'users', user.uid), {
      email: user.email, role: role, displayName: user.email.split('@')[0]
    }).then(function(){ return role; });
  });
}

// ---------- observador de autenticação ----------
onAuthStateChanged(auth, function(user){
  if (!user){
    currentUser = null; currentRole = null;
    loginScreen.style.display = 'flex';
    onboardScreen.style.display = 'none';
    appShell.style.display = 'none';
    return;
  }
  currentUser = user;
  getDoc(doc(db, 'users', user.uid)).then(function(snap){
    if (snap.exists()){
      currentRole = snap.data().role;
      enterApp();
    } else {
      loginScreen.style.display = 'none';
      onboardScreen.style.display = 'flex';
      provisionNewUser(user).then(function(role){
        currentRole = role;
        enterApp();
      }).catch(function(err){
        onboardMsg.textContent = 'Não foi possível preparar sua conta. Peça para o master verificar o acesso. (' + err.message + ')';
      });
    }
  });
});

function enterApp(){
  loginScreen.style.display = 'none';
  onboardScreen.style.display = 'none';
  appShell.style.display = 'flex';
  sidebarUser.textContent = currentUser.email + ' · ' + (currentRole === 'master' ? 'master' : 'visualizador(a)');
  document.querySelectorAll('.master-only').forEach(function(el){
    el.style.display = (currentRole === 'master') ? '' : 'none';
  });
  initDataAndViews();
}

// ---------- navegação da barra lateral ----------
document.querySelectorAll('.nav-item[data-view]').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(function(v){ v.style.display = 'none'; });
    document.getElementById('view-' + btn.dataset.view).style.display = 'block';
  });
});

// ---------- utilitários ----------
function stripAccents(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function fmt(n){ if (n === null || n === undefined || isNaN(n)) return '—'; return n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmtSigned(n){ if (n === null || n === undefined || isNaN(n)) return '—'; var s = fmt(Math.abs(n)); return (n<0?'−':(n>0?'+':'')) + s; }
function fmtDate(iso){ var p = iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }

// ---------- Firestore: snapshots ----------
function listSnapshotDates(){
  return getDocs(collection(db, 'snapshots')).then(function(qs){
    var dates = []; qs.forEach(function(d){ dates.push(d.id); }); return dates.sort();
  });
}
function loadSnapshot(date){
  return getDoc(doc(db, 'snapshots', date)).then(function(d){ return d.exists() ? d.data() : null; });
}
function saveSnapshot(date, rows){
  return setDoc(doc(db, 'snapshots', date), { date: date, rows: rows, savedAt: new Date().toISOString(), ownerId: currentUser.uid });
}
function deleteSnapshot(date){
  return deleteDoc(doc(db, 'snapshots', date));
}

// ---------- Firestore: categorias ----------
var DEFAULT_CATS = ['Comissões','Fiscalização','Atendimento','Fundo de Apoio','Projetos','Administrativo/Outros'];
function loadCategoriasDoc(){
  return getDoc(doc(db, 'config', 'categorias')).then(function(d){
    return d.exists() ? d.data() : { map: {}, list: DEFAULT_CATS.slice() };
  });
}
function saveCategoriasDoc(data){ return setDoc(doc(db, 'config', 'categorias'), data); }

function suggestCategory(nome){
  if (/^0[2-9]\s*-/.test(nome)) return 'Comissões';
  var n = stripAccents(nome);
  if (n.indexOf('fiscalizacao') !== -1) return 'Fiscalização';
  if (n.indexOf('atendimento') !== -1) return 'Atendimento';
  if (n.indexOf('fundo de apoio') !== -1) return 'Fundo de Apoio';
  if (n.indexOf('projeto') !== -1) return 'Projetos';
  if (n.indexOf('comissao') !== -1 || n.indexOf('camara') !== -1 || n.indexOf('conselho diretor') !== -1) return 'Comissões';
  return 'Administrativo/Outros';
}

// ---------- estado em memória (cache local pós-login) ----------
var catState = { map: {}, list: DEFAULT_CATS.slice() };
var lastCurrentSnap = null;
var lastReportDiffsRaw = null;
var lastReportDates = null;
var lastReportRows = null;
var trendChartInstance = null;
var reportChartInstance = null;

function initDataAndViews(){
  Promise.all([loadCategoriasDoc(), listSnapshotDates()]).then(function(res){
    catState = res[0];
    var dates = res[1];
    return Promise.all(dates.map(loadSnapshot)).then(function(snaps){
      var changed = false;
      snaps.forEach(function(snap){
        snap.rows.forEach(function(r){
          if (!catState.map[r.centro]){ catState.map[r.centro] = suggestCategory(r.centro); changed = true; }
        });
      });
      var save = changed && currentRole === 'master' ? saveCategoriasDoc(catState) : Promise.resolve();
      return save.then(function(){
        renderFilterCategoriaOptions();
        renderCatTable();
        renderSnapshotChips(dates);
        renderDateSelects(dates);
        lastCurrentSnap = snaps.length ? snaps[snaps.length-1] : null;
        renderCurrent(lastCurrentSnap);
        renderCategorySummary(lastCurrentSnap);
        renderTrendChart(dates, snaps);
      });
    });
  });
  document.getElementById('contaInfo').textContent = 'Logado como ' + currentUser.email + ' (' + (currentRole==='master'?'master':'visualizador(a)') + ').';
}

// ---------- filtros ----------
var filterCategoria = document.getElementById('filterCategoria');
var filterBusca = document.getElementById('filterBusca');
document.getElementById('filterClear').addEventListener('click', function(){
  filterCategoria.value = '__todas__'; filterBusca.value = ''; refreshFilteredViews();
});
filterCategoria.addEventListener('change', refreshFilteredViews);
filterBusca.addEventListener('input', refreshFilteredViews);

function passesFilter(centro){
  var cat = filterCategoria.value;
  if (cat !== '__todas__' && catState.map[centro] !== cat) return false;
  var busca = stripAccents(filterBusca.value.trim());
  if (busca && stripAccents(centro).indexOf(busca) === -1) return false;
  return true;
}
function refreshFilteredViews(){
  if (lastCurrentSnap){ renderCurrent(lastCurrentSnap); renderCategorySummary(lastCurrentSnap); }
  if (lastReportDiffsRaw) renderReport(lastReportDates[0], lastReportDates[1], lastReportDiffsRaw);
}

function renderFilterCategoriaOptions(){
  var current = filterCategoria.value || '__todas__';
  filterCategoria.innerHTML = '<option value="__todas__">Todas as categorias</option>';
  catState.list.forEach(function(c){ var o = document.createElement('option'); o.value=c; o.textContent=c; filterCategoria.appendChild(o); });
  if ([].slice.call(filterCategoria.options).some(function(o){return o.value===current;})) filterCategoria.value = current;
}

// ---------- categorias (tabela) ----------
var catTableBody = document.querySelector('#catTable tbody');
document.getElementById('newCatBtn').addEventListener('click', function(){
  var name = (document.getElementById('newCatInput').value || '').trim();
  if (!name || currentRole !== 'master') return;
  if (catState.list.indexOf(name) === -1){
    catState.list.push(name);
    saveCategoriasDoc(catState).then(function(){ renderFilterCategoriaOptions(); renderCatTable(); });
  }
  document.getElementById('newCatInput').value = '';
});

function renderCatTable(){
  var centros = Object.keys(catState.map).sort(function(a,b){return a.localeCompare(b);});
  catTableBody.innerHTML = '';
  if (!centros.length){ catTableBody.innerHTML = '<tr><td colspan="2" class="muted">Nenhum retrato salvo ainda.</td></tr>'; return; }
  centros.forEach(function(centro){
    var tr = document.createElement('tr');
    var tdCentro = document.createElement('td'); tdCentro.textContent = centro;
    var tdSel = document.createElement('td');
    if (currentRole === 'master'){
      var sel = document.createElement('select');
      catState.list.forEach(function(c){ var o=document.createElement('option'); o.value=c; o.textContent=c; if (c===catState.map[centro]) o.selected=true; sel.appendChild(o); });
      sel.addEventListener('change', function(){
        catState.map[centro] = sel.value;
        saveCategoriasDoc(catState).then(refreshFilteredViews);
      });
      tdSel.appendChild(sel);
    } else {
      tdSel.textContent = catState.map[centro] || '—';
    }
    tr.appendChild(tdCentro); tr.appendChild(tdSel);
    catTableBody.appendChild(tr);
  });
}

// ---------- situação atual ----------
var currentCard = document.getElementById('currentCard');
function renderCurrent(snap){
  if (!snap || !snap.rows.length){ currentCard.innerHTML = '<p class="muted">Nenhum retrato salvo ainda.</p>'; return; }
  var rows = snap.rows.filter(function(r){ return passesFilter(r.centro); }).sort(function(a,b){return a.centro.localeCompare(b.centro);});
  var tot = {orcado:0,empenho:0,liquidacao:0,pagamento:0,saldoOrc:0,saldoLiq:0,saldoPagar:0};
  rows.forEach(function(r){ tot.orcado+=r.orcado; tot.empenho+=r.empenho; tot.liquidacao+=(r.liquidacao||0); tot.pagamento+=r.pagamento; tot.saldoOrc+=r.saldoOrc; tot.saldoLiq+=r.saldoLiq; tot.saldoPagar+=(r.saldoPagar||0); });
  var pct = tot.orcado ? (tot.pagamento/tot.orcado*100) : 0;
  var html = '<p class="muted" style="margin:0 0 12px;">Referente a ' + fmtDate(snap.date) + ' · ' + rows.length + ' de ' + snap.rows.length + ' centros exibidos</p>';
  html += '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:12px; margin-bottom:18px;">';
  html += '<div class="metric"><div class="label">Orçado total</div><div class="value">R$ '+fmt(tot.orcado)+'</div></div>';
  html += '<div class="metric"><div class="label">Pago até aqui</div><div class="value">R$ '+fmt(tot.pagamento)+'</div></div>';
  html += '<div class="metric blue"><div class="label">Saldo de orçamento</div><div class="value">R$ '+fmt(tot.saldoOrc)+'</div></div>';
  html += '<div class="metric orange"><div class="label">% executado</div><div class="value">'+pct.toFixed(2)+'%</div></div></div>';
  if (!rows.length){ html += '<p class="muted">Nenhum centro de custo corresponde ao filtro atual.</p>'; currentCard.innerHTML = html; return; }
  html += '<div class="cc-grid">';
  rows.forEach(function(r){
    var temLiq = r.liquidacao !== null && r.liquidacao !== undefined;
    var pctEmp = r.orcado ? (r.empenho / r.orcado * 100) : 0;
    var pctLiq = r.orcado && temLiq ? (r.liquidacao / r.orcado * 100) : 0;
    var pctPag = r.orcado ? (r.pagamento / r.orcado * 100) : 0;
    var pctEmpBar = Math.min(pctEmp, 100);
    var pctLiqBar = Math.min(pctLiq, 100);
    var pctPagBar = Math.min(pctPag, 100);
    html += '<div class="cc-card">';
    html += '<div class="cc-name">'+r.centro+'</div>';
    html += '<div class="cc-cat">'+(catState.map[r.centro]||'sem categoria')+'</div>';
    html += '<div class="cc-orcado">Orçado: <strong>R$ '+fmt(r.orcado)+'</strong></div>';
    html += '<div class="pbar-row"><span>Empenhado</span><span>R$ '+fmt(r.empenho)+' · '+pctEmp.toFixed(1)+'%</span></div>';
    html += '<div class="pbar"><div class="pbar-fill empenho'+(pctEmp>100?' over':'')+'" style="width:'+pctEmpBar+'%;"></div></div>';
    if (temLiq){
      html += '<div class="pbar-row"><span>Liquidado</span><span>R$ '+fmt(r.liquidacao)+' · '+pctLiq.toFixed(1)+'%</span></div>';
      html += '<div class="pbar"><div class="pbar-fill liquidado'+(pctLiq>100?' over':'')+'" style="width:'+pctLiqBar+'%;"></div></div>';
    }
    html += '<div class="pbar-row"><span>Pago</span><span>R$ '+fmt(r.pagamento)+' · '+pctPag.toFixed(1)+'%</span></div>';
    html += '<div class="pbar"><div class="pbar-fill pago'+(pctPag>100?' over':'')+'" style="width:'+pctPagBar+'%;"></div></div>';
    html += '<div class="cc-saldos">';
    html += '<div class="cc-saldo-box"><div class="cc-saldo-label">Saldo do orçamento</div><div class="cc-saldo-value">R$ '+fmt(r.saldoOrc)+'</div></div>';
    html += '<div class="cc-saldo-box"><div class="cc-saldo-label">Saldo a liquidar</div><div class="cc-saldo-value">R$ '+fmt(r.saldoLiq)+'</div></div>';
    if (r.saldoPagar !== null && r.saldoPagar !== undefined){
      html += '<div class="cc-saldo-box"><div class="cc-saldo-label">Saldo a pagar</div><div class="cc-saldo-value">R$ '+fmt(r.saldoPagar)+'</div></div>';
    }
    html += '</div></div>';
  });
  html += '</div>';
  currentCard.innerHTML = html;
}

// ---------- resumo por categoria ----------
var categorySummaryCard = document.getElementById('categorySummaryCard');
function renderCategorySummary(snap){
  if (!snap || !snap.rows.length){ categorySummaryCard.innerHTML = '<p class="muted">Nenhum retrato salvo ainda.</p>'; return; }
  var busca = stripAccents(filterBusca.value.trim());
  var rows = snap.rows.filter(function(r){ return !busca || stripAccents(r.centro).indexOf(busca) !== -1; });
  var byCat = {};
  rows.forEach(function(r){
    var cat = catState.map[r.centro] || 'Sem categoria';
    if (!byCat[cat]) byCat[cat] = {orcado:0,empenho:0,liquidacao:0,pagamento:0,saldoOrc:0,saldoLiq:0,saldoPagar:0,n:0};
    byCat[cat].orcado+=r.orcado; byCat[cat].empenho+=r.empenho; byCat[cat].liquidacao+=(r.liquidacao||0); byCat[cat].pagamento+=r.pagamento;
    byCat[cat].saldoOrc+=r.saldoOrc; byCat[cat].saldoLiq+=r.saldoLiq; byCat[cat].saldoPagar+=(r.saldoPagar||0); byCat[cat].n+=1;
  });
  var cats = Object.keys(byCat).sort(function(a,b){ return byCat[b].orcado - byCat[a].orcado; });
  var html = '<div style="overflow-x:auto;"><table><thead><tr><th>Categoria</th><th>Centros</th><th>Orçado</th><th>Empenhado</th><th>Liquidado</th><th>Pago</th><th>Saldo orçamento</th><th>Saldo a liquidar</th><th>Saldo a pagar</th><th>% executado</th></tr></thead><tbody>';
  cats.forEach(function(cat){
    var c = byCat[cat]; var pct = c.orcado ? (c.pagamento/c.orcado*100) : 0;
    html += '<tr><td>'+cat+'</td><td>'+c.n+'</td><td>'+fmt(c.orcado)+'</td><td>'+fmt(c.empenho)+'</td><td>'+fmt(c.liquidacao)+'</td><td>'+fmt(c.pagamento)+'</td><td>'+fmt(c.saldoOrc)+'</td><td>'+fmt(c.saldoLiq)+'</td><td>'+fmt(c.saldoPagar)+'</td><td>'+pct.toFixed(2)+'%</td></tr>';
  });
  html += '</tbody></table></div>';
  categorySummaryCard.innerHTML = html;
}

// ---------- evolução no tempo ----------
var trendMetric = document.getElementById('trendMetric');
var trendEmpty = document.getElementById('trendEmpty');
var trendCanvas = document.getElementById('trendChart');
trendMetric.addEventListener('change', function(){
  listSnapshotDates().then(function(dates){ Promise.all(dates.map(loadSnapshot)).then(function(snaps){ renderTrendChart(dates, snaps); }); });
});
function renderTrendChart(dates, snaps){
  if (dates.length < 2){
    trendEmpty.style.display='block'; trendEmpty.textContent='Salve ao menos 2 retratos para ver a evolução no tempo.'; trendCanvas.style.display='none';
    if (trendChartInstance){ trendChartInstance.destroy(); trendChartInstance=null; }
    return;
  }
  if (typeof Chart === 'undefined'){
    trendEmpty.style.display='block'; trendEmpty.textContent='Não consegui carregar a biblioteca de gráficos.'; trendCanvas.style.display='none';
    return;
  }
  var metric = trendMetric.value;
  var values = snaps.map(function(snap){ return snap.rows.filter(function(r){return passesFilter(r.centro);}).reduce(function(a,r){return a+(r[metric]||0);},0); });
  trendEmpty.style.display='none'; trendCanvas.style.display='block';
  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(trendCanvas, {
    type:'line',
    data: { labels: dates.map(fmtDate), datasets: [{ label: trendMetric.options[trendMetric.selectedIndex].text, data: values, borderColor:'#C4703E', backgroundColor:'rgba(196,112,62,0.12)', tension:0.25, fill:true, pointRadius:3, pointBackgroundColor:'#C4703E' }] },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{ y:{ ticks:{ callback:function(v){return 'R$ '+fmt(v);} }, grid:{color:'#E0DACB'} }, x:{ grid:{display:false} } } }
  });
}

// ---------- retratos (upload) — só master ----------
var fileInput = document.getElementById('fileInput');
var saveBtn = document.getElementById('saveBtn');
var parseStatus = document.getElementById('parseStatus');
var chipsWrap = document.getElementById('chipsWrap');
var dateFromInput = document.getElementById('dateFromInput');
var dateToInput = document.getElementById('dateToInput');
var dateFromList = document.getElementById('dateFromList');
var dateToList = document.getElementById('dateToList');
var reportBtn = document.getElementById('reportBtn');
var csvBtn = document.getElementById('csvBtn');

function extractDateFromFilename(name){
  var matches = name.match(/\d{8}/g);
  if (!matches || !matches.length) return null;
  var last = matches[matches.length - 1];
  var dd = parseInt(last.slice(0,2), 10), mm = parseInt(last.slice(2,4), 10), yyyy = parseInt(last.slice(4,8), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2000 || yyyy > 2100) return null;
  return yyyy + '-' + String(mm).padStart(2,'0') + '-' + String(dd).padStart(2,'0');
}

function parseWorkbook(file, cb){
  var reader = new FileReader();
  reader.onload = function(e){
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var data = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
      if (!data.length) throw new Error('Planilha vazia.');
      var header = data[0].map(stripAccents);
      function findCol(keys){ for (var i=0;i<header.length;i++){ var h=header[i]; if(!h) continue; if (keys.every(function(k){return h.indexOf(k)!==-1;})) return i; } return -1; }
      var cCentro=findCol(['centro']), cOrcado=findCol(['orcad']), cEmpenho=findCol(['empenho']);
      var cLiquidacao=findCol(['liquidacao']);
      var cPagamento=findCol(['pagamento']), cSaldoOrc=findCol(['saldo','orc']);
      var cSaldoLiq=findCol(['saldo','liquid']); if (cSaldoLiq===-1) cSaldoLiq=findCol(['remanescente']);
      var cSaldoPagar=findCol(['saldo','pagar']);
      if (cCentro===-1 || cOrcado===-1) throw new Error('Não encontrei as colunas esperadas.');
      var rows=[];
      for (var r=1;r<data.length;r++){
        var row=data[r]; if (!row || row[cCentro]===null || row[cCentro]==='') continue;
        rows.push({
          centro:String(row[cCentro]).trim(), orcado:Number(row[cOrcado])||0, empenho:Number(row[cEmpenho])||0,
          liquidacao: cLiquidacao!==-1 ? (Number(row[cLiquidacao])||0) : null,
          pagamento:Number(row[cPagamento])||0, saldoOrc:Number(row[cSaldoOrc])||0, saldoLiq:Number(row[cSaldoLiq])||0,
          saldoPagar: cSaldoPagar!==-1 ? (Number(row[cSaldoPagar])||0) : null
        });
      }
      if (!rows.length) throw new Error('Nenhuma linha encontrada.');
      cb(null, rows);
    } catch(err){ cb(err); }
  };
  reader.onerror = function(){ cb(new Error('Falha ao ler o arquivo.')); };
  reader.readAsArrayBuffer(file);
}

if (fileInput) fileInput.addEventListener('change', function(){
  var files = Array.prototype.slice.call(fileInput.files || []);
  if (!files.length){ saveBtn.disabled = true; parseStatus.textContent=''; return; }
  var preview = files.map(function(f){
    var d = extractDateFromFilename(f.name);
    return (d ? fmtDate(d) : '⚠ sem data reconhecível') + ' — ' + f.name;
  });
  parseStatus.innerHTML = files.length + ' arquivo(s) selecionado(s):<br>' + preview.join('<br>');
  saveBtn.disabled = false;
});

if (saveBtn) saveBtn.addEventListener('click', function(){
  var files = Array.prototype.slice.call(fileInput.files || []);
  if (!files.length) return;
  saveBtn.disabled = true; saveBtn.textContent = 'Processando...';
  var results = [];
  var chain = Promise.resolve();
  files.forEach(function(file){
    chain = chain.then(function(){
      var date = extractDateFromFilename(file.name);
      if (!date){ results.push(file.name + ': não encontrei uma data de 8 dígitos (ddmmaaaa) no nome do arquivo — pulado.'); return; }
      return new Promise(function(resolve){
        parseWorkbook(file, function(err, rows){
          if (err){ results.push(file.name + ': erro ao ler — ' + err.message); resolve(); return; }
          saveSnapshot(date, rows).then(function(){
            var changed = false;
            rows.forEach(function(r){ if (!catState.map[r.centro]){ catState.map[r.centro] = suggestCategory(r.centro); changed = true; } });
            return changed ? saveCategoriasDoc(catState) : Promise.resolve();
          }).then(function(){
            results.push(file.name + ': salvo como retrato de ' + fmtDate(date) + ' (' + rows.length + ' centros de custo).');
            resolve();
          }).catch(function(err){
            results.push(file.name + ': erro ao salvar — ' + err.message);
            resolve();
          });
        });
      });
    });
  });
  chain.then(function(){
    parseStatus.innerHTML = results.join('<br>');
    fileInput.value = ''; saveBtn.textContent = 'Salvar retrato(s)'; saveBtn.disabled = true;
    initDataAndViews();
  });
});

function renderSnapshotChips(dates){
  if (!chipsWrap) return;
  if (!dates.length){ chipsWrap.innerHTML = '<span class="muted">Nenhum retrato salvo ainda.</span>'; return; }
  chipsWrap.innerHTML = '';
  dates.forEach(function(d){
    var chip = document.createElement('span'); chip.className='chip'; chip.innerHTML = '<span>'+fmtDate(d)+'</span>';
    var del = document.createElement('button');
    del.innerHTML = '&times;';
    del.title = 'Excluir este retrato';
    del.addEventListener('click', function(){
      var ok = window.confirm('Excluir o retrato de ' + fmtDate(d) + '? Essa ação não pode ser desfeita.');
      if (!ok) return;
      del.disabled = true;
      deleteSnapshot(d).then(function(){
        initDataAndViews();
      }).catch(function(err){
        alert('Não foi possível excluir: ' + err.message);
        del.disabled = false;
      });
    });
    chip.appendChild(del);
    chipsWrap.appendChild(chip);
  });
}
var availableDates = [];

function setDateComboValue(inputEl, iso){
  inputEl.value = iso ? fmtDate(iso) : '';
  inputEl.dataset.iso = iso || '';
}
function getDateComboValue(inputEl){ return inputEl.dataset.iso || ''; }

function setupDateCombo(inputEl, listEl){
  function renderList(filterText){
    var f = stripAccents(filterText || '');
    var matches = availableDates.filter(function(d){ return stripAccents(fmtDate(d)).indexOf(f) !== -1; });
    listEl.innerHTML = '';
    if (!matches.length){
      listEl.innerHTML = '<div class="date-combo-item no-match">Nenhuma data encontrada</div>';
    } else {
      matches.forEach(function(d){
        var item = document.createElement('div');
        item.className = 'date-combo-item';
        item.textContent = fmtDate(d);
        item.addEventListener('mousedown', function(e){
          e.preventDefault();
          setDateComboValue(inputEl, d);
          listEl.style.display = 'none';
        });
        listEl.appendChild(item);
      });
    }
    listEl.style.display = 'block';
  }
  inputEl.addEventListener('focus', function(){ renderList(inputEl.value); });
  inputEl.addEventListener('input', function(){ inputEl.dataset.iso = ''; renderList(inputEl.value); });
  inputEl.addEventListener('blur', function(){ setTimeout(function(){ listEl.style.display = 'none'; }, 150); });
}
setupDateCombo(dateFromInput, dateFromList);
setupDateCombo(dateToInput, dateToList);

function renderDateSelects(dates){
  availableDates = dates;
  if (dates.length){
    setDateComboValue(dateFromInput, dates[0]);
    setDateComboValue(dateToInput, dates[dates.length-1]);
  }
  reportBtn.disabled = dates.length < 2;
}

document.querySelectorAll('.preset-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    if (!availableDates.length) return;
    document.querySelectorAll('.preset-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    var endISO = availableDates[availableDates.length - 1];
    var preset = btn.dataset.preset;
    var startISO;
    if (preset === 'tudo'){
      startISO = availableDates[0];
    } else if (preset === 'mes'){
      var endD = new Date(endISO + 'T00:00:00');
      var monthStart = endD.getFullYear() + '-' + String(endD.getMonth()+1).padStart(2,'0') + '-01';
      startISO = availableDates.find(function(d){ return d >= monthStart; }) || availableDates[0];
    } else {
      var days = parseInt(preset, 10);
      var target = new Date(endISO + 'T00:00:00');
      target.setDate(target.getDate() - days);
      var targetISO = target.toISOString().slice(0,10);
      startISO = availableDates.find(function(d){ return d >= targetISO; }) || availableDates[0];
    }
    setDateComboValue(dateFromInput, startISO);
    setDateComboValue(dateToInput, endISO);
  });
});


// ---------- relatório do período ----------
var reportOut = document.getElementById('reportOut');
if (reportBtn) reportBtn.addEventListener('click', function(){
  var d1=getDateComboValue(dateFromInput), d2=getDateComboValue(dateToInput);
  if (!d1||!d2){ reportOut.innerHTML = '<p class="muted">Escolha uma data inicial e final válidas (use os atalhos ou digite e escolha da lista).</p>'; return; }
  reportBtn.disabled=true; reportBtn.textContent='Gerando...';
  Promise.all([loadSnapshot(d1), loadSnapshot(d2)]).then(function(res){
    var snapA=res[0], snapB=res[1];
    var mapA={}; snapA.rows.forEach(function(r){mapA[r.centro]=r;});
    var mapB={}; snapB.rows.forEach(function(r){mapB[r.centro]=r;});
    var centros = Object.keys(mapB).sort(function(a,b){return a.localeCompare(b);});
    var diffs = centros.map(function(c){
      var a=mapA[c], b=mapB[c];
      return { centro:c, orcado:b.orcado, orcadoMudou: a ? (a.orcado!==b.orcado) : false,
        dEmpenho: b.empenho-(a?a.empenho:0), dLiquidacao: (b.liquidacao||0)-(a?(a.liquidacao||0):0), dPagamento: b.pagamento-(a?a.pagamento:0),
        dSaldoOrc: b.saldoOrc-(a?a.saldoOrc:0), dSaldoLiq: b.saldoLiq-(a?a.saldoLiq:0), dSaldoPagar: (b.saldoPagar||0)-(a?(a.saldoPagar||0):0), semDadoInicial: !a };
    });
    lastReportDiffsRaw = diffs; lastReportDates=[d1,d2];
    renderReport(d1,d2,diffs);
    reportBtn.disabled=false; reportBtn.textContent='Gerar relatório'; csvBtn.disabled=false;
  }).catch(function(err){ reportOut.innerHTML='<p class="muted">Erro: '+err.message+'</p>'; reportBtn.disabled=false; reportBtn.textContent='Gerar relatório'; });
});

function renderReport(d1, d2, diffsAll){
  var diffs = diffsAll.filter(function(r){ return passesFilter(r.centro); });
  lastReportRows = diffs;
  var tot={dEmpenho:0,dLiquidacao:0,dPagamento:0,dSaldoOrc:0,dSaldoLiq:0,dSaldoPagar:0};
  diffs.forEach(function(r){ tot.dEmpenho+=r.dEmpenho; tot.dLiquidacao+=r.dLiquidacao; tot.dPagamento+=r.dPagamento; tot.dSaldoOrc+=r.dSaldoOrc; tot.dSaldoLiq+=r.dSaldoLiq; tot.dSaldoPagar+=r.dSaldoPagar; });
  var days = Math.round((new Date(d2)-new Date(d1))/86400000);
  var html = '<p class="muted" style="margin:0 0 12px;">'+fmtDate(d1)+' → '+fmtDate(d2)+' · '+days+' dias · '+diffs.length+' de '+diffsAll.length+' centros exibidos</p>';
  if (!diffs.length){ html += '<p class="muted">Nenhum centro corresponde ao filtro atual.</p>'; reportOut.innerHTML = html; return; }
  html += '<div style="overflow-x:auto;"><table><thead><tr><th>Centro de custo</th><th>Categoria</th><th>Orçado</th><th>Δ empenhado</th><th>Δ liquidado</th><th>Δ pago</th><th>Δ saldo orçamento</th><th>Δ saldo a liquidar</th><th>Δ saldo a pagar</th></tr></thead><tbody>';
  diffs.forEach(function(r){
    html += '<tr><td>'+r.centro+(r.semDadoInicial?' <span class="muted">(novo)</span>':'')+'</td><td>'+(catState.map[r.centro]||'—')+'</td><td>'+fmt(r.orcado)+(r.orcadoMudou?' <span class="muted">*</span>':'')+'</td>';
    html += '<td class="'+(r.dEmpenho>=0?'pos':'neg')+'">'+fmtSigned(r.dEmpenho)+'</td><td class="'+(r.dLiquidacao>=0?'pos':'neg')+'">'+fmtSigned(r.dLiquidacao)+'</td><td class="'+(r.dPagamento>=0?'pos':'neg')+'">'+fmtSigned(r.dPagamento)+'</td>';
    html += '<td class="'+(r.dSaldoOrc>=0?'pos':'neg')+'">'+fmtSigned(r.dSaldoOrc)+'</td><td class="'+(r.dSaldoLiq>=0?'pos':'neg')+'">'+fmtSigned(r.dSaldoLiq)+'</td><td class="'+(r.dSaldoPagar>=0?'pos':'neg')+'">'+fmtSigned(r.dSaldoPagar)+'</td></tr>';
  });
  html += '<tr class="total"><td>Total</td><td></td><td>—</td><td class="'+(tot.dEmpenho>=0?'pos':'neg')+'">'+fmtSigned(tot.dEmpenho)+'</td><td class="'+(tot.dLiquidacao>=0?'pos':'neg')+'">'+fmtSigned(tot.dLiquidacao)+'</td><td class="'+(tot.dPagamento>=0?'pos':'neg')+'">'+fmtSigned(tot.dPagamento)+'</td><td class="'+(tot.dSaldoOrc>=0?'pos':'neg')+'">'+fmtSigned(tot.dSaldoOrc)+'</td><td class="'+(tot.dSaldoLiq>=0?'pos':'neg')+'">'+fmtSigned(tot.dSaldoLiq)+'</td><td class="'+(tot.dSaldoPagar>=0?'pos':'neg')+'">'+fmtSigned(tot.dSaldoPagar)+'</td></tr></tbody></table></div>';
  var hasChanged = diffs.some(function(r){return r.orcadoMudou;});
  if (hasChanged) html += '<p class="muted" style="margin-top:10px;">* o orçado mudou entre as datas.</p>';
  html += '<div style="margin-top:20px;"><canvas id="reportChart" height="90"></canvas></div>';
  reportOut.innerHTML = html;

  if (typeof Chart === 'undefined'){ document.getElementById('reportChart').outerHTML = '<p class="muted">Não consegui carregar a biblioteca de gráficos.</p>'; return; }
  var byCat = {};
  diffs.forEach(function(r){ var cat = catState.map[r.centro] || 'Sem categoria'; byCat[cat] = (byCat[cat]||0) + r.dPagamento; });
  var catLabels = Object.keys(byCat).sort(); var catValues = catLabels.map(function(c){return byCat[c];});
  if (reportChartInstance) reportChartInstance.destroy();
  reportChartInstance = new Chart(document.getElementById('reportChart'), {
    type:'bar',
    data:{ labels:catLabels, datasets:[{ label:'Δ pago no período', data:catValues, backgroundColor: catValues.map(function(v){return v>=0?'#5F8054':'#B5473A';}) }] },
    options:{ responsive:true, plugins:{legend:{display:false}, title:{display:true, text:'Δ pago por categoria', color:'#211F1C', font:{size:12}}}, scales:{ y:{ ticks:{callback:function(v){return 'R$ '+fmt(v);}}, grid:{color:'#E0DACB'} }, x:{grid:{display:false}} } }
  });
}

if (csvBtn) csvBtn.addEventListener('click', function(){
  if (!lastReportRows) return;
  var lines = [['Centro de custo','Categoria','Orcado','Delta Empenhado','Delta Liquidado','Delta Pago','Delta Saldo Orcamento','Delta Saldo a Liquidar','Delta Saldo a Pagar'].join(';')];
  lastReportRows.forEach(function(r){ lines.push([r.centro, catState.map[r.centro]||'', r.orcado, r.dEmpenho, r.dLiquidacao, r.dPagamento, r.dSaldoOrc, r.dSaldoLiq, r.dSaldoPagar].join(';')); });
  var blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob); var a = document.createElement('a');
  a.href=url; a.download='relatorio_'+getDateComboValue(dateFromInput)+'_a_'+getDateComboValue(dateToInput)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

// ---------- backup ----------
var exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.addEventListener('click', function(){
  listSnapshotDates().then(function(dates){
    Promise.all(dates.map(loadSnapshot)).then(function(snaps){
      var backup = { exportedAt: new Date().toISOString(), snapshots: snaps, categorias: catState.map, category_list: catState.list };
      var blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json;charset=utf-8;'});
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      a.href=url; a.download='backup_historico_orcamentario_'+todayISO+'.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });
  });
});

// ---------- minha conta ----------
document.getElementById('changePasswordBtn').addEventListener('click', function(){
  var msg = document.getElementById('passwordMsg');
  var v = document.getElementById('newPasswordInput').value;
  if (!v || v.length < 6){ msg.textContent = 'A senha precisa ter ao menos 6 caracteres.'; return; }
  updatePassword(currentUser, v).then(function(){
    msg.textContent = 'Senha alterada com sucesso.';
    document.getElementById('newPasswordInput').value = '';
  }).catch(function(err){
    msg.textContent = 'Não foi possível trocar agora — faça login novamente e tente de novo (' + err.code + ').';
  });
});
