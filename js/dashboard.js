const money=(v)=>'$'+v;
let muted='#898781',grid='#e1e0d9',VIOLET='#534ab7';
let COL={weekday:'#898781',friday:'#2a78d6',saturday:'#008300',sunday:'#d55181'};
let DAYCOL={Fri:COL.friday,Sat:COL.saturday,Sun:COL.sunday};
// pull the current theme's colors from CSS variables so charts follow light/dark
function cssVar(n){try{return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}catch(e){return '';}}
function refreshTheme(){
  muted=cssVar('--muted')||muted;grid=cssVar('--grid')||grid;VIOLET=cssVar('--violet')||VIOLET;
  COL={weekday:cssVar('--gray')||COL.weekday,friday:cssVar('--blue')||COL.friday,saturday:cssVar('--green')||COL.saturday,sunday:cssVar('--pink')||COL.sunday};
  DAYCOL={Fri:COL.friday,Sat:COL.saturday,Sun:COL.sunday};
}
const SEED={weekday:[[1,57],[8,57],[15,57],[29,33],[57,20],[92,20]],friday:[[4,77],[11,77],[18,77],[32,57],[46,57],[60,35]],saturday:[[5,77],[12,43],[33,26],[89,20]],sunday:[[6,57],[34,43],[62,20]],rtSatSun:[[6,134],[34,69],[62,40]],rtFriSun:[[5,134],[33,100],[61,55]]};
const pts=(a)=>a.map(([x,y])=>({x,y}));

// ---- fare basis: "sensible" (usable departure times) vs "absolute" (any train, incl. late-night) ----
let DATA=[],MODE='sensible',FLOOR=20,toggleWired=false;
let c1,c2,c3,c4,c5,c6;
const WINDOWS={out:[7,17],ret:[8,19.5]};           // sensible departure windows (hours)
const fareOf=(r)=>MODE==='sensible'&&r.sens!=null?r.sens:r.low;
const trainOf=(r)=>MODE==='sensible'&&r.strain?r.strain:r.ltrain;
const depOf=(r)=>MODE==='sensible'&&r.sdep?r.sdep:r.ldep;
function parseTime(t){const m=/^(\d{1,2}):(\d{2})([ap])$/.exec((t||'').trim());if(!m)return null;let h=(+m[1])%12;if(m[3]==='p')h+=12;return h+(+m[2])/60;}
function fmtHour(h){let H=Math.round(h)%24;const ap=H<12?'am':'pm';let hh=H%12;if(hh===0)hh=12;return hh+ap;}

const bandPlugin={id:'band',beforeDraw(chart){if(chart.canvas.id!=='c1')return;const {ctx,chartArea:a,scales:{x,y}}=chart;if(!x||!a)return;const x1=x.getPixelForValue(42),x2=x.getPixelForValue(63);ctx.save();ctx.fillStyle=hexA(COL.saturday,0.12);ctx.fillRect(x1,a.top,x2-x1,a.bottom-a.top);const yf=y.getPixelForValue(FLOOR);ctx.strokeStyle=muted;ctx.setLineDash([5,4]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.left,yf);ctx.lineTo(a.right,yf);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=COL.saturday;ctx.font='600 11px sans-serif';ctx.fillText('sweet spot',x1+6,a.top+14);ctx.fillStyle=muted;ctx.fillText('$'+FLOOR+' floor',a.left+6,yf-5);ctx.restore();}};
const winPlugin={id:'win',beforeDraw(chart){if(chart.canvas.id!=='c2')return;const {ctx,chartArea:a,scales:{x}}=chart;if(!x||!a)return;const w=chart.$win||WINDOWS.out;const x1=x.getPixelForValue(w[0]),x2=x.getPixelForValue(w[1]);ctx.save();ctx.fillStyle=hexA(COL.saturday,0.10);ctx.fillRect(x1,a.top,x2-x1,a.bottom-a.top);ctx.fillStyle=COL.saturday;ctx.font='600 11px sans-serif';ctx.fillText('sensible window',x1+6,a.top+14);ctx.restore();}};

function baseOpts(xmax,ymax,xl,yl){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>(c.dataset.label?c.dataset.label+': ':'')+'$'+c.parsed.y+(c.parsed.x!=null?' @ '+c.parsed.x+'d':'')}}},scales:{x:{type:'linear',min:0,max:xmax,title:{display:true,text:xl,color:muted},ticks:{color:muted,callback:(v)=>v+'d'},grid:{display:false}},y:{min:0,max:ymax,title:{display:true,text:yl,color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}};}
function seedC1(){c1=new Chart(document.getElementById('c1'),{type:'line',plugins:[bandPlugin],data:{datasets:[{label:'Weekday',data:pts(SEED.weekday),borderColor:COL.weekday,backgroundColor:COL.weekday,borderWidth:2,borderDash:[5,4],tension:.3,pointRadius:3},{label:'Friday out',data:pts(SEED.friday),borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:4},{label:'Saturday out',data:pts(SEED.saturday),borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:4,pointStyle:'rectRot'},{label:'Sunday return',data:pts(SEED.sunday),borderColor:COL.sunday,backgroundColor:COL.sunday,borderWidth:2,tension:.3,pointRadius:4,pointStyle:'triangle'}]},options:baseOpts(95,90,'Days booked before departure','Cheapest coach')});}
function seedC3(){c3=new Chart(document.getElementById('c3'),{type:'line',data:{datasets:[{label:'Sat + Sun',data:pts(SEED.rtSatSun),borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:5,pointStyle:'rectRot'},{label:'Fri + Sun',data:pts(SEED.rtFriSun),borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:5}]},options:baseOpts(70,150,'Days booked before departure','Round-trip total')});}
function initDashboard(){
  refreshTheme();
  wireTheme();
  seedC1();seedC3();
  document.getElementById('loadBtn').onclick=()=>document.getElementById('csvInput').click();
  document.getElementById('csvInput').onchange=(e)=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{ingest(parseCSV(r.result));}catch(err){document.getElementById('loadStatus').textContent='Could not read file: '+err.message;}};r.readAsText(f);};
  const ls=document.getElementById('timeLeg');if(ls)ls.onchange=buildTimeChart;
  const as=document.getElementById('acelaLeg');if(as)as.onchange=buildAcela;
}
function syncThemeBtn(){const btn=document.getElementById('themeToggle');if(!btn)return;const dark=document.documentElement.getAttribute('data-theme')==='dark';btn.textContent=dark?'☀️ Light':'🌙 Dark';btn.setAttribute('aria-pressed',dark?'true':'false');}
function wireTheme(){const btn=document.getElementById('themeToggle');if(!btn)return;syncThemeBtn();btn.onclick=()=>{const dark=document.documentElement.getAttribute('data-theme')==='dark';const next=dark?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('amtrak-theme',next);}catch(e){}refreshTheme();syncThemeBtn();if(DATA.length)render();else{if(c1)c1.destroy();if(c3)c3.destroy();seedC1();seedC3();}};}
function parseCSV(txt){const lines=txt.trim().split(/\r?\n/).filter(l=>l.length);const head=lines[0].split(',').map(s=>s.trim());const idx=(n)=>head.indexOf(n);const rows=[];for(let i=1;i<lines.length;i++){const c=lines[i].split(',');const num=(v)=>{v=(v||'').trim();return v===''?null:parseFloat(v);};const txt=(v)=>{v=(v||'').trim();return v===''?null:v;};rows.push({captured:(c[idx('captured_date')]||'').trim(),travel:(c[idx('travel_date')]||'').trim(),dow:(c[idx('day_of_week')]||'').trim(),dir:(c[idx('direction')]||'').trim(),days:num(c[idx('days_ahead')]),low:num(c[idx('lowest_coach_usd')]),seats:num(c[idx('seats_at_lowest')]),next:num(c[idx('next_coach_usd')]),acela:num(c[idx('acela_business_usd')]),ltrain:txt(c[idx('lowest_train')]),ldep:txt(c[idx('lowest_depart')]),sens:num(c[idx('sensible_coach_usd')]),strain:txt(c[idx('sensible_train')]),sdep:txt(c[idx('sensible_depart')])});}return rows.filter(r=>r.low!=null&&r.days!=null&&r.dow);}
const BUCKETS=[[0,9,5],[10,19,15],[20,34,27],[35,49,42],[50,69,60],[70,120,90]];
function bandFor(rows,fare){fare=fare||((r)=>r.low);const out=[];for(const [lo,hi,mid] of BUCKETS){const vals=rows.filter(r=>r.days>=lo&&r.days<=hi).map(fare).sort((a,b)=>a-b);if(!vals.length)continue;out.push({x:mid,med:vals[Math.floor((vals.length-1)/2)],min:vals[0],max:vals[vals.length-1]});}return out;}
function legRows(rows,dow,dir){return rows.filter(r=>r.dow===dow&&r.dir===dir);}
function hexA(hex,a){const n=parseInt(hex.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
function weekendKey(r){const d=new Date(r.travel+'T00:00:00');const off={Fri:1,Sat:0,Sun:-1}[r.dow];if(off==null)return null;d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);}
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(k){const d=new Date(k+'T00:00:00');return MON[d.getMonth()]+' '+d.getDate();}
function nthWeekday(y,m,wd,n){let d=new Date(y,m,1),c=0;while(c<6){if(d.getDay()===wd&&++c===n)return d;d.setDate(d.getDate()+1);}return d;}
function holidayList(y){return [{name:'Labor Day',date:nthWeekday(y,8,1,1)},{name:'Columbus Day',date:nthWeekday(y,9,1,2)},{name:'Veterans Day',date:new Date(y,10,11)},{name:'Thanksgiving',date:nthWeekday(y,10,4,4)},{name:'Christmas',date:new Date(y,11,25)},{name:"New Year's",date:new Date(y,0,1)},{name:'MLK Day',date:nthWeekday(y,0,1,3)}];}
function holidayName(satKey){const sat=new Date(satKey+'T00:00:00'),y=sat.getFullYear();const hs=[...holidayList(y-1),...holidayList(y),...holidayList(y+1)];for(const h of hs){if(Math.abs((h.date-sat)/86400000)<=3)return h.name;}return null;}
// mode-aware per-weekend round-trip totals for the season view
function seasonData(rows,latest){
  const lr=rows.filter(r=>r.captured===latest),wk={};
  lr.forEach(r=>{const k=weekendKey(r);if(!k)return;const o=wk[k]=wk[k]||{k,seats:[]};const f=fareOf(r);
    if(o['f'+r.dow]==null||f<o['f'+r.dow]){o['f'+r.dow]=f;o['t'+r.dow]=trainOf(r);o['d'+r.dow]=depOf(r);}
    if(r.seats!=null)o.seats.push(r.seats);});
  return Object.values(wk).map(o=>{const outFare=Math.min(o.fFri??Infinity,o.fSat??Infinity);const rt=(o.fSun!=null&&outFare<Infinity)?outFare+o.fSun:null;const outDay=(o.fSat!=null&&o.fSat<=(o.fFri??Infinity))?'Sat':(o.fFri!=null?'Fri':null);
    return {k:o.k,rt,outDay,outTrain:outDay==='Sat'?o.tSat:o.tFri,outDep:outDay==='Sat'?o.dSat:o.dFri,retTrain:o.tSun,retDep:o.dSun,minSeats:o.seats.length?Math.min(...o.seats):null,holiday:holidayName(o.k)};
  }).filter(w=>w.rt!=null);
}
const seasonLabels={id:'seasonLabels',afterDatasetsDraw(chart){if(chart.canvas.id!=='c6')return;const {ctx,chartArea:a,scales:{y}}=chart;const meta=chart.getDatasetMeta(0),vals=chart.data.datasets[0].data;if(!vals.length)return;const minV=Math.min(...vals);ctx.save();ctx.font='600 10px sans-serif';ctx.textAlign='center';vals.forEach((v,i)=>{const bar=meta.data[i];if(!bar)return;if(v>y.max){ctx.fillStyle=cssVar('--red')||'#e24b4a';ctx.fillText('$'+v,bar.x,a.top+11);}else if(v===minV){ctx.fillStyle=cssVar('--green')||'#008300';ctx.fillText('$'+v,bar.x,bar.y-4);}});ctx.restore();}};

function ingest(rows){
  if(!rows.length){document.getElementById('loadStatus').textContent='No valid fare rows found.';return;}
  DATA=rows;
  const caps=[...new Set(rows.map(r=>r.captured))].sort();
  const timed=rows.some(r=>r.sens!=null||r.sdep||r.ldep);
  document.getElementById('loadStatus').innerHTML='<b>Live:</b> '+rows.length+' fares · '+caps.length+' day(s) · '+caps[0]+' → '+caps[caps.length-1];
  document.getElementById('metaline').textContent='Live from fare log · '+rows.length+' samples · captures '+caps[0]+'–'+caps[caps.length-1]+(timed?' · time-aware':'');
  const sb=document.getElementById('staleBanner'),ageDays=Math.floor((Date.now()-new Date(caps[caps.length-1]+'T00:00:00'))/86400000);
  if(ageDays>2){sb.style.display='block';sb.textContent='⚠ Newest capture is '+caps[caps.length-1]+' ('+ageDays+' days ago) — the daily tracker may have stopped running. Fares below could be outdated.';}else sb.style.display='none';
  wireToggle();
  render();
}
function wireToggle(){if(toggleWired)return;const t=document.getElementById('modeToggle');if(!t)return;t.querySelectorAll('.segbtn').forEach(btn=>{btn.onclick=()=>{if(btn.dataset.mode===MODE)return;MODE=btn.dataset.mode;render();};});toggleWired=true;}
function syncToggleUI(){const t=document.getElementById('modeToggle');if(!t)return;t.querySelectorAll('.segbtn').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===MODE));const hint=document.getElementById('modeHint');if(hint)hint.textContent=MODE==='sensible'?'Fares for trains at usable hours (out 7am–5pm · back 8am–7:30pm).':'Absolute cheapest seat on any train — the floor often rides a late-evening train.';}

function render(){
  const rows=DATA;if(!rows.length)return;
  const caps=[...new Set(rows.map(r=>r.captured))].sort();const latest=caps[caps.length-1];
  const fares=rows.map(fareOf).filter(Number.isFinite);
  FLOOR=fares.length?Math.min(20,...fares):20;
  syncToggleUI();
  // 1 · fare vs lead time (mode-aware bands)
  const legs=[['Fri','NHV-BOS',COL.friday],['Sat','NHV-BOS',COL.saturday],['Sun','BOS-NHV',COL.sunday]];
  const ds=[{label:'Weekday (seed)',data:pts(SEED.weekday),borderColor:COL.weekday,backgroundColor:COL.weekday,borderWidth:2,borderDash:[5,4],tension:.3,pointRadius:2}];
  legs.forEach(([dow,dir,col])=>{const b=bandFor(legRows(rows,dow,dir),fareOf);if(!b.length)return;const rgba=hexA(col,0.13);ds.push({label:dow+' max',data:b.map(p=>({x:p.x,y:p.max})),borderColor:'transparent',backgroundColor:rgba,pointRadius:0,fill:'+1',tension:.3});ds.push({label:dow+' min',data:b.map(p=>({x:p.x,y:p.min})),borderColor:'transparent',backgroundColor:rgba,pointRadius:0,fill:false,tension:.3});ds.push({label:dow+' median',data:b.map(p=>({x:p.x,y:p.med})),borderColor:col,backgroundColor:col,borderWidth:2,tension:.3,pointRadius:4});});
  const ymax=Math.max(90,...rows.map(fareOf).filter(Number.isFinite))+8;
  c1.destroy();c1=new Chart(document.getElementById('c1'),{type:'line',plugins:[bandPlugin],data:{datasets:ds},options:baseOpts(95,ymax,'Days booked before departure','Cheapest coach ('+(MODE==='sensible'?'sensible hours':'any train')+')')});
  rebuildRT(rows,latest);
  forecast(rows);
  buildTrajectory(rows);
  buildScarcity(rows,latest);
  buildKPIs(rows,latest);
  buildTimeChart();
  buildAcela();
  buildSeason(rows,latest);
}

// Season view: cheapest bookable round-trip per weekend across the horizon, + a ranking table
function buildSeason(rows,latest){
  const data=seasonData(rows,latest);
  const chartEl=document.getElementById('c6'),tableEl=document.getElementById('seasonTable');
  if(!data.length){if(c6){c6.destroy();c6=null;}if(tableEl)tableEl.innerHTML='<div class="placeholder">Need at least one full weekend (outbound + Sunday return) in the latest capture.</div>';return;}
  const green=cssVar('--green')||'#008300',red=cssVar('--red')||'#e24b4a';
  const byDate=[...data].sort((a,b)=>a.k<b.k?-1:1);
  const labels=byDate.map(w=>shortDate(w.k)),vals=byDate.map(w=>w.rt),colors=byDate.map(w=>w.holiday?red:green);
  const nonHol=byDate.filter(w=>!w.holiday).map(w=>w.rt);
  const ymax=Math.max(90,...(nonHol.length?nonHol:vals))+18;
  if(c6)c6.destroy();
  c6=new Chart(chartEl,{type:'bar',plugins:[seasonLabels],data:{labels,datasets:[{label:'Cheapest round trip',data:vals,backgroundColor:colors,borderRadius:4,maxBarThickness:38}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>{const w=byDate[c.dataIndex];return '$'+w.rt+(w.holiday?' · '+w.holiday:'')+' · '+(w.outDay||'')+' out '+(w.outTrain?'#'+w.outTrain+' ':'')+(w.outDep||'');}}}},scales:{x:{ticks:{color:muted,maxRotation:60,minRotation:45},grid:{display:false}},y:{min:0,max:ymax,title:{display:true,text:'Bookable round trip ('+(MODE==='sensible'?'sensible':'any train')+')',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});
  const rank=[...data].sort((a,b)=>a.rt-b.rt);
  let h='<table><tr><th>#</th><th>Weekend</th><th>Bookable RT</th><th>Outbound</th><th>Return</th><th>Seats</th><th></th></tr>';
  rank.forEach((w,i)=>{const scarce=w.minSeats!=null&&w.minSeats<=2;const outTxt=(w.outDay||'—')+(w.outTrain?' #'+w.outTrain:'')+(w.outDep?' '+w.outDep:'');const retTxt='Sun'+(w.retTrain?' #'+w.retTrain:'')+(w.retDep?' '+w.retDep:'');h+='<tr><td class="num">'+(i+1)+'</td><td>'+shortDate(w.k)+'</td><td class="num'+(i===0?' best':'')+'">$'+w.rt+'</td><td>'+outTxt+'</td><td>'+retTxt+'</td><td class="num '+(scarce?'scarce':'')+'">'+(w.minSeats!=null?w.minSeats+(scarce?' ⚠':''):'—')+'</td><td>'+(w.holiday?'<span class="pill">'+w.holiday+'</span>':'')+'</td></tr>';});
  h+='</table><p class="note">Cheapest bookable round trip per weekend at the current fare basis. ⚠ = ≤2 seats left at the lowest price on some leg. Holiday weekends can be far pricier — see the badge.</p>';
  if(tableEl)tableEl.innerHTML=h;
}

// Acela Business on its own chart + axis so the coach chart stays readable
function buildAcela(){
  const rows=DATA;if(!rows||!rows.length)return;
  const sel=document.getElementById('acelaLeg');const leg=sel?sel.value:'all';
  const src=rows.filter(r=>r.acela!=null&&(leg==='all'||r.dow===leg));
  const b=bandFor(src,(r)=>r.acela);
  const note=document.getElementById('acelaNote');
  if(!b.length){if(c5){c5.destroy();c5=null;}if(note)note.textContent='No Acela Business fares logged for this leg yet.';return;}
  const orange=cssVar('--orange')||'#eb6834',rgba=hexA(orange,0.13);
  const ds=[
    {label:'Acela max',data:b.map(p=>({x:p.x,y:p.max})),borderColor:'transparent',backgroundColor:rgba,pointRadius:0,fill:'+1',tension:.3},
    {label:'Acela min',data:b.map(p=>({x:p.x,y:p.min})),borderColor:'transparent',backgroundColor:rgba,pointRadius:0,fill:false,tension:.3},
    {label:'Acela median',data:b.map(p=>({x:p.x,y:p.med})),borderColor:orange,backgroundColor:orange,borderWidth:2,tension:.3,pointRadius:4}
  ];
  const vals=b.flatMap(p=>[p.min,p.max]);
  const ymin=Math.max(0,Math.floor((Math.min(...vals)-20)/10)*10),ymax=Math.max(...vals)+15;
  if(c5)c5.destroy();
  c5=new Chart(document.getElementById('c5'),{type:'line',data:{datasets:ds},options:baseOpts(95,ymax,'Days booked before departure','Acela Business')});
  c5.options.scales.y.min=ymin;c5.update();
  if(note)note.textContent='Own scale ('+money(ymin)+'–'+money(Math.round(ymax))+') so the coach chart stays readable. Median line with min–max band.';
}

function rebuildRT(rows,latest){const lr=rows.filter(r=>r.captured===latest);const byWk={};lr.forEach(r=>{const k=weekendKey(r);if(!k)return;const o=byWk[k]=byWk[k]||{};o[r.dow]=Math.min(o[r.dow]??Infinity,fareOf(r));if(r.dow==='Sat')o.satDays=r.days;});const satPts=[],friPts=[];Object.values(byWk).forEach(o=>{if(o.satDays==null||o.Sun==null)return;if(o.Sat<Infinity)satPts.push({x:o.satDays,y:o.Sat+o.Sun});if(o.Fri<Infinity)friPts.push({x:o.satDays,y:o.Fri+o.Sun});});satPts.sort((a,b)=>a.x-b.x);friPts.sort((a,b)=>a.x-b.x);const xmax=Math.max(70,...satPts.map(p=>p.x),...friPts.map(p=>p.x))+5;const ymax=Math.max(150,...satPts.map(p=>p.y),...friPts.map(p=>p.y))+10;c3.destroy();c3=new Chart(document.getElementById('c3'),{type:'line',data:{datasets:[{label:'Sat + Sun',data:satPts,borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:5,pointStyle:'rectRot'},{label:'Fri + Sun',data:friPts,borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:5}]},options:baseOpts(xmax,ymax,'Days before departure (Saturday)','Round-trip total ('+(MODE==='sensible'?'sensible':'any train')+')')});}

function forecast(rows){
  const box=document.getElementById('forecastBox');
  const legs=[['Friday out','Fri','NHV-BOS',COL.friday],['Saturday out','Sat','NHV-BOS',COL.saturday],['Sunday return','Sun','BOS-NHV',COL.sunday]];
  let html='<table><tr><th>Leg</th><th>Modeled floor</th><th>Book by</th><th>Fit pts</th></tr>';let any=false;
  legs.forEach(([name,dow,dir,col])=>{
    const m={};legRows(rows,dow,dir).forEach(r=>{m[r.days]=Math.min(m[r.days]??Infinity,fareOf(r));});
    const P=Object.entries(m).map(([d,y])=>({d:+d,y}));
    if(P.length<3){html+='<tr><td>'+name+'</td><td colspan="3" style="color:var(--muted)">need ≥3 lead-times ('+P.length+' so far)</td></tr>';return;}
    const floor=Math.min(...P.map(p=>p.y));
    const xs=P.map(p=>p.d),ys=P.map(p=>Math.log(Math.max(p.y-floor,1)));
    const n=xs.length,sx=xs.reduce((a,b)=>a+b,0),sy=ys.reduce((a,b)=>a+b,0),sxx=xs.reduce((a,b)=>a+b*b,0),sxy=xs.map((x,i)=>x*ys[i]).reduce((a,b)=>a+b,0);
    const den=(n*sxx-sx*sx);const b=den!==0?(n*sxy-sx*sy)/den:0;const a=(sy-b*sx)/n;const A=Math.exp(a),k=-b;
    let bookBy;if(k>0.0008){const dsx=Math.log(Math.max(A/3,1))/k;bookBy=dsx>7?'~'+Math.round(dsx/7)+' weeks ahead':'~1 week ahead (drops fast)';}else bookBy='stays flat — book anytime';
    html+='<tr><td><span style="color:'+col+'">●</span> '+name+'</td><td class="num">$'+floor+'</td><td>'+bookBy+'</td><td class="num">'+P.length+'</td></tr>';any=true;
  });
  html+='</table>';box.className=any?'':'placeholder';
  box.innerHTML=any?html+'<p class="note">Model: fare = floor + A·e^(−k·days-ahead), least-squares on '+(MODE==='sensible'?'sensible-hour':'absolute-lowest')+' points. Early fits are directional; they tighten as the log grows.</p>':'Load a log with ≥3 lead-times per leg to model floors.';
}

function buildTrajectory(rows){
  const wknds=[...new Set(rows.map(weekendKey).filter(Boolean))].sort();const sel=document.getElementById('trajSelect');const prev=sel.value;sel.innerHTML='';wknds.forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent='Weekend of Sat '+k;sel.appendChild(o);});if(prev&&wknds.includes(prev))sel.value=prev;
  const caps=[...new Set(rows.map(r=>r.captured))].sort();
  if(caps.length<2){document.getElementById('trajPlaceholder').style.display='block';document.getElementById('trajControls').style.display='none';document.getElementById('trajBox').style.display='none';return;}
  document.getElementById('trajPlaceholder').style.display='none';document.getElementById('trajControls').style.display='block';document.getElementById('trajBox').style.display='block';
  const draw=()=>{const k=sel.value;const wk=rows.filter(r=>weekendKey(r)===k);const wc=[...new Set(wk.map(r=>r.captured))].sort();const ser=wc.map(cap=>{const s=wk.filter(r=>r.captured===cap);const fri=Math.min(Infinity,...s.filter(r=>r.dow==='Fri').map(fareOf));const sat=Math.min(Infinity,...s.filter(r=>r.dow==='Sat').map(fareOf));const sun=Math.min(Infinity,...s.filter(r=>r.dow==='Sun').map(fareOf));const out=Math.min(fri,sat);return (out<Infinity&&sun<Infinity)?{x:cap,y:out+sun}:null;}).filter(Boolean);const labels=ser.map(p=>p.x),vals=ser.map(p=>p.y);if(c4)c4.destroy();c4=new Chart(document.getElementById('c4'),{type:'line',data:{labels,datasets:[{label:'Cheapest round trip',data:vals,borderColor:VIOLET,backgroundColor:hexA(VIOLET,0.10),borderWidth:2,fill:true,tension:.3,pointRadius:4,pointBackgroundColor:VIOLET,pointBorderColor:cssVar('--card')||'#fff',pointBorderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>'$'+c.parsed.y+' on '+c.label}}},scales:{x:{title:{display:true,text:'Capture date',color:muted},ticks:{color:muted},grid:{display:false}},y:{beginAtZero:false,title:{display:true,text:'Round-trip total ('+(MODE==='sensible'?'sensible':'any train')+')',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});const v=document.getElementById('trajVerdict');if(vals.length){const cur=vals[vals.length-1],min=Math.min(...vals),trend=vals.length>=3?cur-vals[vals.length-3]:0;const cap=(FLOOR+40);let msg,cls;if(cur<=min+3&&cur<=cap){msg='At/near floor — book now.';cls='best';}else if(trend>4){msg='Rising — book soon.';cls='win';}else{msg='Drifting down — okay to wait.';cls='';}v.innerHTML='<span class="'+cls+'">'+msg+'</span> <span style="color:var(--muted)">(now $'+cur+', low $'+min+')</span>';}else v.textContent='';};
  sel.onchange=draw;draw();
}

function buildScarcity(rows,latest){const lr=rows.filter(r=>r.captured===latest&&r.seats!=null).sort((a,b)=>a.seats-b.seats);const box=document.getElementById('scarcityBox');if(!lr.length){box.className='placeholder';box.textContent='Latest capture had no seats-left data.';return;}box.className='';let h='<table><tr><th>Travel date</th><th>Leg</th><th>Lowest</th><th>Train</th><th>Seats</th><th>Next</th></tr>';lr.slice(0,10).forEach(r=>{const s=r.seats<=2;const tr=(r.ltrain?('#'+r.ltrain+(r.ldep?' · '+r.ldep:'')):'—');h+='<tr><td>'+r.travel+' ('+r.dow+')</td><td>'+r.dir+'</td><td class="num">$'+r.low+'</td><td>'+tr+'</td><td class="num '+(s?'scarce':'')+'">'+r.seats+(s?' ⚠':'')+'</td><td class="num">'+(r.next!=null?'$'+r.next:'—')+'</td></tr>';});h+='</table><p class="note">⚠ = ≤2 seats at the lowest price; expect a jump to the next price. Train column shows the departure carrying that lowest fare.</p>';box.innerHTML=h;}

// 4 · fare by departure time — real logged trains, sensible window shaded, filter by leg
function buildTimeChart(){
  const rows=DATA;if(!rows||!rows.length)return;
  const legSel=document.getElementById('timeLeg');const leg=legSel?legSel.value:'all';
  const filt=rows.filter(r=>leg==='all'||r.dow===leg);
  const byDay={Fri:[],Sat:[],Sun:[]};
  filt.forEach(r=>{const seen=new Set();[[r.ldep,r.low,r.ltrain],[r.sdep,r.sens,r.strain]].forEach(([d,f,t])=>{if(!d||f==null)return;const h=parseTime(d);if(h==null)return;const key=t||d;if(seen.has(key))return;seen.add(key);(byDay[r.dow]||(byDay[r.dow]=[])).push({x:h,y:f,train:t,dep:d,days:r.days,travel:r.travel,dow:r.dow});});});
  const style={Fri:'circle',Sat:'rectRot',Sun:'triangle'};
  const datasets=Object.entries(byDay).filter(([,pts])=>pts.length).map(([dow,pts])=>({label:dow,data:pts,borderColor:DAYCOL[dow],backgroundColor:hexA(DAYCOL[dow],0.65),pointStyle:style[dow],pointRadius:5,pointHoverRadius:7}));
  const note=document.getElementById('timeNote');
  if(!datasets.length){if(c2){c2.destroy();c2=null;}if(note)note.textContent='No departure-time data logged yet for this leg.';return;}
  const win=leg==='Sun'?WINDOWS.ret:WINDOWS.out;
  const allF=datasets.flatMap(d=>d.data.map(p=>p.y));const ymax=Math.max(...allF)+15;
  if(c2)c2.destroy();
  c2=new Chart(document.getElementById('c2'),{type:'scatter',plugins:[winPlugin],data:{datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'bottom',labels:{color:muted,usePointStyle:true,boxWidth:8}},tooltip:{callbacks:{label:(c)=>{const p=c.raw;return '$'+p.y+' · '+p.dow+' '+(p.train?'#'+p.train+' ':'')+fmtHour(p.x)+' · '+p.days+'d ahead';}}}},scales:{x:{type:'linear',min:0,max:24,title:{display:true,text:'Departure time',color:muted},ticks:{color:muted,stepSize:3,callback:(v)=>fmtHour(v)},grid:{color:grid}},y:{min:0,max:ymax,title:{display:true,text:'Coach fare',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});
  c2.$win=win;c2.update();
  if(note)note.textContent='Shaded = usable hours ('+fmtHour(win[0])+'–'+fmtHour(win[1])+'). Points outside it — mostly the cheapest fares — ride early-morning or late-evening trains.';
}

function buildKPIs(rows,latest){
  const lr=rows.filter(r=>r.captured===latest);
  const agg={};lr.forEach(r=>{const k=weekendKey(r);if(!k)return;const o=agg[k]=agg[k]||{k};const s=r.sens!=null?r.sens:r.low;
    if(o['a'+r.dow]==null||r.low<o['a'+r.dow]){o['a'+r.dow]=r.low;o['ad'+r.dow]=r.ldep;}
    if(o['s'+r.dow]==null||s<o['s'+r.dow]){o['s'+r.dow]=s;o['sd'+r.dow]=r.sdep||r.ldep;o['st'+r.dow]=r.strain||r.ltrain;}
    if(r.dow==='Sat')o.days=r.days;});
  let best=null,bestS=null;
  Object.values(agg).forEach(o=>{
    if(o.aSun!=null){const out=Math.min(o.aFri??Infinity,o.aSat??Infinity);if(out<Infinity){const rt=out+o.aSun;if(!best||rt<best.rt)best={k:o.k,rt};}}
    if(o.sSun!=null){const outv=Math.min(o.sFri??Infinity,o.sSat??Infinity);if(outv<Infinity){const rt=outv+o.sSun;const day=(o.sSat!=null&&o.sSat<=(o.sFri??Infinity))?'Saturday':'Friday';const dep=day==='Saturday'?o.sdSat:o.sdFri;const tr=day==='Saturday'?o.stSat:o.stFri;if(!bestS||rt<bestS.rt)bestS={k:o.k,rt,day,dep,tr,retDep:o.sdSun,retTr:o.stSun};}}});
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const setH=(id,v)=>{const e=document.getElementById(id);if(e)e.innerHTML=v;};
  // KPI 1: best bookable RT (sensible)
  if(bestS){set('kpiCheapRT','$'+bestS.rt);const trip=[bestS.tr?'#'+bestS.tr:'',bestS.dep||''].filter(Boolean).join(' ');setH('kpiCheapFoot',bestS.day+' out'+(trip?' ('+trip+')':'')+' · wknd '+bestS.k);}
  else{set('kpiCheapRT','—');set('kpiCheapFoot','no full weekend yet');}
  // KPI 2: absolute floor RT (any train)
  if(best){set('kpiFloorRT','$'+best.rt);setH('kpiFloorFoot',(bestS&&best.rt<bestS.rt)?'on a late-evening train':'same as bookable');}
  else{set('kpiFloorRT','—');set('kpiFloorFoot','—');}
  // KPI 3: late-train "tax" = avg (sensible − absolute) per leg
  const gaps=lr.filter(r=>r.sens!=null&&r.sens>r.low).map(r=>r.sens-r.low);
  if(gaps.length){const avg=Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length);set('kpiTax','$'+avg);setH('kpiTaxFoot',gaps.length+' of '+lr.length+' legs cheaper on a late train');}
  else{set('kpiTax','$0');set('kpiTaxFoot','cheapest train already daytime');}
  // KPI 4: booking-early savings % (current mode)
  const b=bandFor(rows,fareOf);let pct=null;if(b.length>=2){const near=b[0].med,far=b[b.length-1].med;if(near>0)pct=Math.round((near-far)/near*100);}
  set('kpiEarly',pct!=null&&pct>0?'~'+pct+'%':'—');set('kpiEarlyFoot',pct!=null?'book ~'+b[b.length-1].x+'d vs ~'+b[0].x+'d out':'need more lead-times');
  // KPI 5: Acela Business premium vs the coach fare you'd otherwise book
  const aps=lr.filter(r=>r.acela!=null).map(r=>r.acela-(r.sens!=null?r.sens:r.low)).filter(v=>v>0);
  if(aps.length){const avg=Math.round(aps.reduce((a,b)=>a+b,0)/aps.length);set('kpiAcela','+$'+avg);setH('kpiAcelaFoot','avg Business over coach ('+aps.length+' legs)');}
  else{set('kpiAcela','—');set('kpiAcelaFoot','no Acela data logged');}
  // recommendation card
  const head=document.getElementById('recHead'),body=document.getElementById('recBody');
  if(MODE==='sensible'&&bestS){head.textContent='Best bookable round trip: '+bestS.day+' out '+(bestS.tr?'(#'+bestS.tr+' '+bestS.dep+') ':'')+'+ Sunday back, weekend of '+bestS.k+' — about $'+bestS.rt+'.';const floorTxt=(best&&best.rt<bestS.rt)?' The absolute floor is ~$'+best.rt+', but that rides a late-evening train.':'';const fl=bestS.rt<=70;body.innerHTML=(fl?'At/near the practical floor — <b>good to book</b>.':'Still above the practical floor; if your weekend is &gt;2 weeks out, watch a few more days.')+floorTxt+' “Sensible” = outbound 7am–5pm, return 8am–7:30pm.';}
  else if(best){head.textContent='Absolute cheapest round trip: weekend of '+best.k+' — about $'+best.rt+' on any train.';body.innerHTML='This is the rock-bottom fare and often rides a late-evening or early-morning train. Switch to <b>Sensible hours</b> above to see the cheapest trip at usable times'+(bestS?' (~$'+bestS.rt+')':'')+'.';}
}

// in a browser: init charts and auto-load the committed CSV (works on GitHub Pages / any http server); skipped under Node so the pure helpers can be require()d by tests
if(typeof document!=='undefined'){initDashboard();fetch('data/amtrak_fare_log.csv',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('http '+r.status);return r.text();}).then(t=>ingest(parseCSV(t))).catch(()=>{document.getElementById('loadStatus').innerHTML='Auto-load unavailable (opened via file://). Click <b>Load fare log</b> and pick <b>data/amtrak_fare_log.csv</b>.';document.getElementById('metaline').textContent='Showing seed snapshot — load the CSV to go live.';});}
if(typeof module!=='undefined'&&module.exports){module.exports={parseCSV,weekendKey,bandFor};}
