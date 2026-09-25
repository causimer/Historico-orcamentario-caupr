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
    return d.exists() ? d.data() : { map: {}, list: DEFAULT_CATS.slice(), colors: {} };
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
var catState = { map: {}, list: DEFAULT_CATS.slice(), colors: {} };
var lastCurrentSnap = null;
var selectedCategories = null; // null = todas selecionadas

function initDataAndViews(){
  Promise.all([loadCategoriasDoc(), listSnapshotDates()]).then(function(res){
    catState = res[0];
    if (!catState.colors) catState.colors = {};
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
        selectedCategories = catState.list.slice();
        renderCatMultiList();
        updateCatMultiBtnLabel();
        renderCatColorList();
        renderCatTable();
        renderSnapshotChips(dates);
        setupDateSlider(dates, snaps);
        lastCurrentSnap = dates.length ? snapshotsByDate[dates[dates.length-1]] : null;
        renderCurrent(lastCurrentSnap);
        renderCategorySummary(lastCurrentSnap);
      });
    });
  });
  document.getElementById('contaInfo').textContent = 'Logado como ' + currentUser.email + ' (' + (currentRole==='master'?'master':'visualizador(a)') + ').';
}

// ---------- filtros ----------
var filterBusca = document.getElementById('filterBusca');
var catMultiCombo = document.getElementById('catMultiCombo');
var catMultiBtn = document.getElementById('catMultiBtn');
var catMultiPanel = document.getElementById('catMultiPanel');
var catMultiList = document.getElementById('catMultiList');
var catMultiAllBtn = document.getElementById('catMultiAll');
var catMultiNoneBtn = document.getElementById('catMultiNone');

document.getElementById('filterClear').addEventListener('click', function(){
  selectedCategories = catState.list.slice();
  filterBusca.value = '';
  renderCatMultiList(); updateCatMultiBtnLabel(); refreshFilteredViews();
});
filterBusca.addEventListener('input', refreshFilteredViews);

catMultiBtn.addEventListener('click', function(e){
  e.stopPropagation();
  catMultiPanel.classList.toggle('open');
});
document.addEventListener('click', function(e){
  if (!catMultiCombo.contains(e.target)) catMultiPanel.classList.remove('open');
});
catMultiAllBtn.addEventListener('click', function(){
  selectedCategories = catState.list.slice();
  renderCatMultiList(); updateCatMultiBtnLabel(); refreshFilteredViews();
});
catMultiNoneBtn.addEventListener('click', function(){
  selectedCategories = [];
  renderCatMultiList(); updateCatMultiBtnLabel(); refreshFilteredViews();
});

function renderCatMultiList(){
  if (selectedCategories === null) selectedCategories = catState.list.slice();
  catMultiList.innerHTML = '';
  catState.list.forEach(function(c){
    var row = document.createElement('label');
    row.className = 'multi-combo-item';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedCategories.indexOf(c) !== -1;
    cb.addEventListener('change', function(){
      if (cb.checked){ if (selectedCategories.indexOf(c) === -1) selectedCategories.push(c); }
      else { selectedCategories = selectedCategories.filter(function(x){ return x !== c; }); }
      updateCatMultiBtnLabel();
      refreshFilteredViews();
    });
    var swatch = document.createElement('span');
    swatch.className = 'multi-combo-swatch';
    swatch.style.background = (catState.colors && catState.colors[c]) || '#F5F1E7';
    var txt = document.createElement('span');
    txt.textContent = c;
    row.appendChild(cb); row.appendChild(swatch); row.appendChild(txt);
    catMultiList.appendChild(row);
  });
}
function updateCatMultiBtnLabel(){
  if (selectedCategories === null || selectedCategories.length === catState.list.length){ catMultiBtn.textContent = 'Todas as categorias'; }
  else if (selectedCategories.length === 0){ catMultiBtn.textContent = 'Nenhuma categoria'; }
  else { catMultiBtn.textContent = selectedCategories.length + ' selecionada(s)'; }
}

function passesFilter(centro){
  if (selectedCategories !== null){
    var cat = catState.map[centro];
    if (selectedCategories.indexOf(cat) === -1) return false;
  }
  var busca = stripAccents(filterBusca.value.trim());
  if (busca && stripAccents(centro).indexOf(busca) === -1) return false;
  return true;
}
function refreshFilteredViews(){
  if (lastCurrentSnap){ renderCurrent(lastCurrentSnap); renderCategorySummary(lastCurrentSnap); }
}

// ---------- categorias (tabela + cores) ----------
var catTableBody = document.querySelector('#catTable tbody');
var catColorList = document.getElementById('catColorList');
document.getElementById('newCatBtn').addEventListener('click', function(){
  var name = (document.getElementById('newCatInput').value || '').trim();
  if (!name || currentRole !== 'master') return;
  if (catState.list.indexOf(name) === -1){
    catState.list.push(name);
    saveCategoriasDoc(catState).then(function(){
      selectedCategories = catState.list.slice();
      renderCatMultiList(); updateCatMultiBtnLabel(); renderCatColorList(); renderCatTable();
    });
  }
  document.getElementById('newCatInput').value = '';
});

function renderCatColorList(){
  if (!catColorList) return;
  if (!catState.colors) catState.colors = {};
  catColorList.innerHTML = '';
  catState.list.forEach(function(c){
    var row = document.createElement('div');
    row.className = 'cat-color-row';
    var input = document.createElement('input');
    input.type = 'color';
    input.value = catState.colors[c] || '#F5F1E7';
    input.addEventListener('change', function(){
      catState.colors[c] = input.value;
      saveCategoriasDoc(catState).then(function(){ renderCatMultiList(); refreshFilteredViews(); });
    });
    var name = document.createElement('span');
    name.className = 'cat-color-name';
    name.textContent = c;
    row.appendChild(input); row.appendChild(name);
    catColorList.appendChild(row);
  });
}

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
    var cardColor = (catState.colors && catState.colors[catState.map[r.centro]]) || '';
    html += '<div class="cc-card"' + (cardColor ? ' style="background:'+cardColor+';"' : '') + '>';
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

// ---------- retratos (upload) — só master ----------
var fileInput = document.getElementById('fileInput');
var saveBtn = document.getElementById('saveBtn');
var parseStatus = document.getElementById('parseStatus');
var chipsWrap = document.getElementById('chipsWrap');

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
var snapshotsByDate = {};
var dateSlider = document.getElementById('dateSlider');
var dateSliderLabel = document.getElementById('dateSliderLabel');

function setupDateSlider(dates, snaps){
  availableDates = dates;
  snapshotsByDate = {};
  snaps.forEach(function(s, i){ snapshotsByDate[dates[i]] = s; });
  if (!dates.length){
    dateSlider.min = 0; dateSlider.max = 0; dateSlider.value = 0; dateSlider.disabled = true;
    dateSliderLabel.textContent = '—';
    return;
  }
  dateSlider.disabled = false;
  dateSlider.min = 0; dateSlider.max = dates.length - 1; dateSlider.value = dates.length - 1;
  dateSliderLabel.textContent = fmtDate(dates[dates.length - 1]);
}
dateSlider.addEventListener('input', function(){
  var idx = parseInt(dateSlider.value, 10);
  var date = availableDates[idx];
  if (!date) return;
  dateSliderLabel.textContent = fmtDate(date);
  lastCurrentSnap = snapshotsByDate[date];
  renderCurrent(lastCurrentSnap);
  renderCategorySummary(lastCurrentSnap);
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
