// BRUTAL BLAST - authoritative server. Clients only send intents; server owns rooms, timers, scores, results.
const express=require('express'),http=require('http'),path=require('path'),{Server}=require('socket.io');
const app=express(),srv=http.createServer(app),io=new Server(srv);
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(q,s)=>s.sendFile(path.join(__dirname,'public','index.html')));
const rooms={},R=n=>Math.floor(Math.random()*n),SYM=['▲','●','■','★','◆'];
const AV=['😎','🤡','👾','🐸','🔥','💀'],GAMES=['speedtap','dontred','memory','number','danger','intruder'];
const DUR={speedtap:8e3,dontred:15e3,memory:20e3,number:25e3,danger:1e4,intruder:2e4};
const REACT=['😂','💀','🔥','😎','😡','🤡','😭','👀','TOO EASY','NO WAY',"YOU'RE DONE",'WATCH THIS','LUCKY!','HAHA','GG'];
const tok=()=>Math.random().toString(36).slice(2,12),clean=t=>String(t||'').replace(/[<>&"'`]/g,'').trim().slice(0,12).toUpperCase();
const mkCode=()=>{let c;do c='BRUTAL-'+Math.random().toString(36).slice(2,5).toUpperCase();while(rooms[c]);return c};
const now=()=>Date.now();

function snap(r,me){
  const pub={...r.pub};
  if(r.game==='memory'&&now()>=pub.hideAt)delete pub.seq; // never leak the sequence after it is hidden
  return{code:r.code,host:r.host,phase:r.phase,round:r.round,game:r.game,final:r.final,ev:r.ev,end:r.end,now:now(),me:me.id,pub,res:r.res,priv:me.priv,
    players:r.players.map(p=>({id:p.id,name:p.name,av:p.av,ready:p.ready,score:p.score,combo:p.combo,best:p.best,wins:p.wins,taps:p.taps,rd:p.rd,maxRd:p.maxRd,on:p.on}))};
}
const bc=r=>r.players.forEach(p=>p.on&&io.to(p.sid).emit('state',snap(r,p)));
const emit=(r,e,d)=>io.to(r.code).emit(e,d);

// ---- scoring ----
function add(r,p,n){const m=(r.final?2:1)*(r.ev==='DOUBLE POINTS'?2:1);if(n>0)n*=m;p.score=Math.max(0,p.score+n);p.rd+=n;emit(r,'pop',{id:p.id,n})}
function ok(r,p,n){p.combo++;p.best=Math.max(p.best,p.combo);add(r,p,n+Math.min(p.combo-1,5)*2);if(p.combo>1)emit(r,'combo',{id:p.id,c:p.combo})}
function bad(r,p,n){if(p.combo>1)emit(r,'broke',{id:p.id});p.combo=0;add(r,p,-n)}
function fin(r,p,msg){p.done=true;p.priv.done=1;p.priv.msg=msg}

// ---- round flow ----
function startRound(r){
  r.round++;r.final=r.round===7;r.game=GAMES[R(GAMES.length)];r.ev=Math.random()<.25?'DOUBLE POINTS':null;
  r.phase='intro';r.end=now()+4e3;r.pub={};r.res=null;r.solved=0;
  r.players.forEach(p=>{p.priv={};p.done=false;p.rd=0;p.taps=0;p.last=0;p.choice=null;p.lvl=0});
  bc(r);r.t=setTimeout(()=>begin(r),4e3);
}
const mkRed=()=>{const g=Array(9).fill(false);let n=2+R(2);while(n){const i=R(9);if(!g[i]){g[i]=true;n--}}return g};
function mkOdd(p){const size=Math.min(3+p.lvl,6),[a,b]=[['O','Q'],['E','F'],['M','N'],['8','B']][R(4)];
  p.odd=R(size*size);p.priv.grid=Array.from({length:size*size},(_,i)=>i===p.odd?b:a)}
function begin(r){
  r.phase='play';r.end=now()+DUR[r.game];
  if(r.game==='dontred')r.players.forEach(p=>{p.grid=mkRed();p.priv.grid=p.grid});
  if(r.game==='intruder')r.players.forEach(mkOdd);
  if(r.game==='memory'){r.seq=Array.from({length:5},()=>SYM[R(5)]);r.pub={seq:r.seq,hideAt:now()+3e3}}
  if(r.game==='number'){const nums=Array.from({length:6},()=>1+R(20));const idx=new Set();const k=2+R(2);while(idx.size<k)idx.add(R(6));
    r.pub={nums,target:[...idx].reduce((s,i)=>s+nums[i],0)}}
  bc(r);r.t=setTimeout(()=>finish(r),DUR[r.game]);
}
function finish(r){
  if(r.phase!=='play')return;clearTimeout(r.t);const notes={};
  if(r.game==='danger')r.players.forEach(p=>{const c=p.choice;if(!c)return;const w=Math.random()<.5;
    add(r,p,c==='SAFE'?10:c==='RISK'?(w?30:-20):(w?100:-100));notes[p.id]=c+(c==='SAFE'?'':w?' ✔':' ✘')});
  r.res={notes};r.phase='result';r.end=now()+4e3;
  const top=Math.max(...r.players.map(p=>p.rd));
  r.players.forEach(p=>{p.maxRd=Math.max(p.maxRd,p.rd);if(top>0&&p.rd===top)p.wins++});
  bc(r);r.t=setTimeout(()=>r.round>=7?endGame(r):startRound(r),4e3);
}
function endGame(r){r.phase='results';r.game=null;bc(r)}
const allDone=r=>r.players.filter(p=>p.on).every(p=>p.done);

// ---- per-game validated actions ----
const H={
  speedtap:(r,p,d)=>{if(d.a==='tap'){p.taps++;add(r,p,2)}},
  dontred:(r,p,d)=>{const i=d.i;if(d.a!=='hit'||!Number.isInteger(i)||i<0||i>8)return;p.grid[i]?bad(r,p,50):ok(r,p,10);p.grid=mkRed();p.priv.grid=p.grid},
  memory:(r,p,d,t)=>{if(d.a!=='seq'||t<r.pub.hideAt||!Array.isArray(d.s)||d.s.length!==5)return;
    const good=d.s.every((v,i)=>v===r.seq[i]);good?ok(r,p,[100,60,30][r.solved++]||20):bad(r,p,20);fin(r,p,good?'CORRECT':'WRONG');allDone(r)&&finish(r)},
  number:(r,p,d)=>{if(d.a!=='sum'||!Array.isArray(d.s)||d.s.length>6||new Set(d.s).size!==d.s.length||!d.s.every(i=>Number.isInteger(i)&&i>=0&&i<6))return;
    if(d.s.reduce((s,i)=>s+r.pub.nums[i],0)===r.pub.target){ok(r,p,[100,60,30][r.solved++]||20);fin(r,p,'SOLVED');allDone(r)&&finish(r)}else bad(r,p,10)},
  danger:(r,p,d)=>{if(d.a!=='ch'||!['SAFE','RISK','CHAOS'].includes(d.c))return;p.choice=d.c;fin(r,p,d.c);allDone(r)&&finish(r)},
  intruder:(r,p,d)=>{if(d.a!=='hit'||!Number.isInteger(d.i))return;if(d.i===p.odd){ok(r,p,20);p.lvl++}else bad(r,p,10);mkOdd(p)}
};

// ---- sockets ----
function addPlayer(r,s,d){
  if(r.players.length>=3)return{err:'ROOM FULL'};if(r.phase!=='lobby')return{err:'MATCH ALREADY STARTED'};
  const p={id:tok(),tok:tok(),name:clean(d.name)||'PLAYER',av:AV.includes(d.av)?d.av:AV[0],ready:!r.players.length,score:0,combo:0,best:0,wins:0,taps:0,rd:0,maxRd:0,on:true,sid:s.id,priv:{},done:false,last:0,lvl:0};
  if(!r.host)r.host=p.id;r.players.push(p);s.join(r.code);s.rid=r.code;s.pid=p.id;bc(r);return{ok:1,code:r.code,tok:p.tok,id:p.id};
}
io.on('connection',s=>{
  const me=()=>{const r=rooms[s.rid];return[r,r&&r.players.find(p=>p.id===s.pid)]};
  s.on('create',(d,cb)=>{const r={code:mkCode(),players:[],phase:'lobby',round:0,pub:{}};rooms[r.code]=r;cb&&cb(addPlayer(r,s,d||{}))});
  s.on('join',(d,cb)=>{const r=rooms[String((d||{}).code).toUpperCase()];cb&&cb(r?addPlayer(r,s,d):{err:'ROOM NOT FOUND'})});
  s.on('rejoin',(d,cb)=>{const r=rooms[String((d||{}).code).toUpperCase()],p=r&&r.players.find(x=>x.tok===d.tok);
    if(!p)return cb&&cb({err:'GONE'});p.on=true;p.sid=s.id;s.join(r.code);s.rid=r.code;s.pid=p.id;bc(r);cb&&cb({ok:1})});
  s.on('ready',()=>{const[r,p]=me();if(r&&p&&r.phase==='lobby'&&p.id!==r.host){p.ready=!p.ready;bc(r)}});
  s.on('start',()=>{const[r,p]=me();if(!r||!p||p.id!==r.host||r.phase!=='lobby')return;
    const rd=r.players.filter(x=>x.ready);if(rd.length<2)return;
    r.players.filter(x=>!x.ready).forEach(x=>io.to(x.sid).emit('kicked'));r.players=rd;startRound(r)});
  s.on('rematch',()=>{const[r,p]=me();if(!r||!p||p.id!==r.host||r.phase!=='results')return;
    r.round=0;r.players.forEach(x=>{x.score=0;x.combo=0;x.best=0;x.wins=0;x.maxRd=0});startRound(r)});
  s.on('act',d=>{const[r,p]=me(),t=now();if(!r||!p||r.phase!=='play'||p.done||t>r.end||!d||typeof d!=='object')return;
    if(t-p.last<40)return;p.last=t;H[r.game](r,p,d,t);bc(r)}); // 40ms floor blocks autoclickers/dup floods
  s.on('react',e=>{const[r,p]=me();if(!r||!p||!REACT.includes(e)||now()-(s.lr||0)<600)return;s.lr=now();emit(r,'react',{id:p.id,t:e})});
  s.on('disconnect',()=>{const[r,p]=me();if(!r||!p)return;p.on=false;
    if(r.phase==='lobby'){r.players=r.players.filter(x=>x!==p)}
    if(r.host===p.id){const n=r.players.find(x=>x.on);if(n){r.host=n.id;n.ready=true}}
    if(!r.players.some(x=>x.on))return void setTimeout(()=>{if(!r.players.some(x=>x.on)){clearTimeout(r.t);delete rooms[r.code]}},6e4);
    if(r.phase==='play'&&allDone(r)&&['memory','number','danger'].includes(r.game))finish(r);else bc(r)});
});
srv.listen(process.env.PORT||3000,()=>console.log('BRUTAL BLAST on :'+(process.env.PORT||3000)));
