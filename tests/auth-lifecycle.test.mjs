import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real setup, observer, provisioning and enterApp integration.
// Firebase operations are deferred explicitly to reproduce out-of-order results.
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const prefix=source.slice(0,source.indexOf('// ---------- navegação da barra lateral ----------'))
 .replace(/^import[\s\S]*?;\n/gm,'');
const OWNER={uid:'CP27dQkMVdUAE8CROxgJnmnkyP92',email:'bruno.simer@caupr.gov.br'};
const VIEWER={uid:'auth-test-viewer',email:'viewer@example.invalid'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const snapshot=data=>({exists:()=>data!==null,data:()=>data});
function harness(){
 const elements=new Map(),reads=[],writes=[],initializations=[];
 let observer,syncCalls=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,style:{},textContent:'',hidden:false,dataset:{},handlers:{},children:[],addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(...children){this.children=children;this.textContent='';},classList:{contains:()=>false,toggle(){}}});return elements.get(id);};
 const shell=element('appShell'),labRoot=element('view-laboratorio'),nav=element('labNav');
 const auth={currentUser:null};
 const sandbox={console,document:{getElementById:element,querySelectorAll:selector=>selector==='.view'?[element('view-inicio'),labRoot]:selector==='.master-only'?[element('masterNav')]:[]},
  initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>({}),doc:(db,...parts)=>({path:parts.join('/')}),
  getDoc:ref=>{const request={path:ref.path,...deferred()};reads.push(request);return request.promise;},
  setDoc:(ref,data)=>{const request={path:ref.path,data,...deferred()};writes.push(request);return request.promise;},
  getDocFromServer:()=>{throw new Error('Unexpected asset request');},onAuthStateChanged:(auth,callback)=>{observer=callback;},
  signInWithEmailAndPassword:()=>Promise.resolve(),signOut:()=>Promise.resolve(),updatePassword:()=>Promise.resolve(),
  createLabController:context=>({sync(){syncCalls++;const user=context.getCurrentUser();const authorized=user?.uid===OWNER.uid&&user?.email===OWNER.email;nav.hidden=!authorized;if(!authorized){labRoot.replaceChildren();labRoot.style.display='none';}},open(){}}),
  initDataAndViews:isCurrent=>initializations.push({uid:auth.currentUser?.uid,isCurrent})};
 vm.createContext(sandbox);vm.runInContext(prefix,sandbox);
 return {shell,labRoot,nav,reads,writes,initializations,element,
  emit(user){auth.currentUser=user;return observer(user);},
  read(path,index=0){return reads.filter(request=>request.path===path)[index];},
  state(){return JSON.parse(vm.runInContext('JSON.stringify({uid:currentUser?.uid||null,role:currentRole})',sandbox));},
  get syncCalls(){return syncCalls;}};
}

test('A new identity immediately clears the owner laboratory before profile lookup finishes',async()=>{
 const h=harness();h.emit(OWNER);h.read('users/'+OWNER.uid).resolve(snapshot({role:'master'}));await tick();
 h.labRoot.textContent='Private owner response';h.labRoot.style.display='block';assert.equal(h.shell.style.display,'flex');
 const before=h.syncCalls;h.emit(VIEWER);
 assert.ok(h.syncCalls>before);assert.equal(h.labRoot.textContent,'');assert.equal(h.labRoot.style.display,'none');assert.equal(h.nav.hidden,true);
 assert.equal(h.shell.style.display,'none');assert.deepEqual(h.state(),{uid:VIEWER.uid,role:null});
 h.read('users/'+VIEWER.uid).resolve(snapshot({role:'viewer'}));await tick();
 assert.equal(h.shell.style.display,'flex');assert.deepEqual(h.state(),{uid:VIEWER.uid,role:'viewer'});
});

test('A profile response finishing after signout cannot reopen the shell or restore a role',async()=>{
 const h=harness();h.emit(OWNER);const pending=h.read('users/'+OWNER.uid);h.emit(null);
 pending.resolve(snapshot({role:'master'}));await tick();
 assert.deepEqual(h.state(),{uid:null,role:null});assert.equal(h.shell.style.display,'none');assert.equal(h.element('loginScreen').style.display,'flex');assert.equal(h.initializations.length,0);
});

test('An older master lookup cannot replace the new viewer session',async()=>{
 const h=harness();h.emit(OWNER);const old=h.read('users/'+OWNER.uid);h.emit(VIEWER);
 h.read('users/'+VIEWER.uid).resolve(snapshot({role:'viewer'}));await tick();old.resolve(snapshot({role:'master'}));await tick();
 assert.deepEqual(h.state(),{uid:VIEWER.uid,role:'viewer'});assert.equal(h.initializations.length,1);assert.ok(h.element('sidebarUser').textContent.includes(VIEWER.email));
});

test('A normal existing owner login opens the app with an active generation guard',async()=>{
 const h=harness();h.emit(OWNER);h.read('users/'+OWNER.uid).resolve(snapshot({role:'master'}));await tick();
 assert.equal(h.shell.style.display,'flex');assert.deepEqual(h.state(),{uid:OWNER.uid,role:'master'});assert.equal(h.nav.hidden,false);assert.equal(h.initializations.length,1);assert.equal(h.initializations[0].isCurrent(),true);
 h.emit(null);assert.equal(h.initializations[0].isCurrent(),false);
});

test('Normal first login provisions only the current viewer and then opens the app',async()=>{
 const h=harness();h.emit(VIEWER);h.read('users/'+VIEWER.uid).resolve(snapshot(null));await tick();
 h.read('config/roles').resolve(snapshot({masterEmail:OWNER.email}));await tick();
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].path,'users/'+VIEWER.uid);assert.equal(h.writes[0].data.role,'viewer');assert.equal(h.writes[0].data.email,VIEWER.email);
 h.writes[0].resolve();await tick();assert.deepEqual(h.state(),{uid:VIEWER.uid,role:'viewer'});assert.equal(h.shell.style.display,'flex');
});

test('Signout while role config is loading prevents stale provisioning writes',async()=>{
 const h=harness();h.emit(VIEWER);h.read('users/'+VIEWER.uid).resolve(snapshot(null));await tick();
 const config=h.read('config/roles');h.emit(null);config.resolve(snapshot({masterEmail:OWNER.email}));await tick();
 assert.equal(h.writes.length,0);assert.equal(h.initializations.length,0);assert.deepEqual(h.state(),{uid:null,role:null});assert.equal(h.shell.style.display,'none');
});

test('Signout during an already submitted provisioning write cannot reopen the app',async()=>{
 const h=harness();h.emit(VIEWER);h.read('users/'+VIEWER.uid).resolve(snapshot(null));await tick();h.read('config/roles').resolve(snapshot({masterEmail:OWNER.email}));await tick();
 h.emit(null);h.writes[0].resolve();await tick();assert.equal(h.initializations.length,0);assert.deepEqual(h.state(),{uid:null,role:null});assert.equal(h.shell.style.display,'none');
});

test('A stale profile failure does not display login errors in a newer session',async()=>{
 const h=harness();h.emit(OWNER);const old=h.read('users/'+OWNER.uid);h.emit(VIEWER);h.read('users/'+VIEWER.uid).resolve(snapshot({role:'viewer'}));await tick();
 old.reject(new Error('Old lookup failed'));await tick();assert.equal(h.element('loginError').textContent,'');assert.equal(h.element('loginScreen').style.display,'none');assert.deepEqual(h.state(),{uid:VIEWER.uid,role:'viewer'});
});
