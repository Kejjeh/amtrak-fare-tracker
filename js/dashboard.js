const muted='#898781',grid='#e1e0d9',money=(v)=>'$'+v;
const COL={weekday:'#898781',friday:'#2a78d6',saturday:'#008300',sunday:'#d55181'};
const DAYCOL={Fri:COL.friday,Sat:COL.saturday,Sun:COL.sunday};
const SEED={weekday:[[1,57],[8,57],[15,57],[29,33],[57,20],[92,20]],friday:[[4,77],[11,77],[18,77],[32,57],[46,57],[60,35]],saturday:[[5,77],[12,43],[33,26],[89,20]],sunday:[[6,57],[34,43],[62,20]],rtSatSun:[[6,134],[34,69],[62,40]],rtFriSun:[[5,134],[33,100],[61,55]]};
const pts=(a)=>a.map(([x,y])=>({x,y}));

// ---- fare basis: "sensible" (usable departure times) vs "absolute" (any train, incl. late-night) ----
let DATA=[],MODE='sensible',FLOOR=20,toggleWired=false;
let c1,c2,c3,c4;
const WINDOWS={out:[7,17],ret:[8,19.5]};           // sensible departure windows (hours)
const fareOf=(r)=>MODE==='sensible'&&r.sens!=null?r.sens:r.low;
const trainOf=(r)=>MODE==='sensible'&&r.strain?r.strain:r.ltrain;
const depOf=(r)=>MODE==='sensible'&&r.sdep?r.sdep:r.ldep;
function parseTime(t){const m=/^(\d{1,2}):(\d{2})([ap])$/.exec((t||'').trim());if(!m)return null;let h=(+m[1])%12;if(m[3]==='p')h+=12;return h+(+m[2])/60;}
function fmtHour(h){let H=Math.round(h)%24;const ap=H<12?'am':'pm';let hh=H%12;if(hh===0)hh=12;return hh+ap;}

const bandPlugin={id:'band',beforeDraw(chart){if(chart.canvas.id!=='c1')return;const {ctx,chartArea:a,scales:{x,y}}=chart;if(!x||!a)return;const x1=x.getPixelForValue(42),x2=x.getPixelForValue(63);ctx.save();ctx.fillStyle='rgba(0,131,0,0.08)';ctx.fillRect(x1,a.top,x2-x1,a.bottom-a.top);const yf=y.getPixelForValue(FLOOR);ctx.strokeStyle='rgba(137,135,129,0.9)';ctx.setLineDash([5,4]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.left,yf);ctx.lineTo(a.right,yf);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#2f7d32';ctx.font='600 11px sans-serif';ctx.fillText('sweet spot',x1+6,a.top+14);ctx.fillStyle=muted;ctx.fillText('$'+FLOOR+' floor',a.left+6,yf-5);ctx.restore();}};
const winPlugin={id:'win',beforeDraw(chart){if(chart.canvas.id!=='c2')return;const {ctx,chartArea:a,scales:{x}}=chart;if(!x||!a)return;const w=chart.$win||WINDOWS.out;const x1=x.getPixelForValue(w[0]),x2=x.getPixelForValue(w[1]);ctx.save();ctx.fillStyle='rgba(0,131,0,0.07)';ctx.fillRect(x1,a.top,x2-x1,a.bottom-a.top);ctx.fillStyle='#2f7d32';ctx.font='600 11px sans-serif';ctx.fillText('sensible window',x1+6,a.top+14);ctx.restore();}};

function baseOpts(xmax,ymax,xl,yl){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>(c.dataset.label?c.dataset.label+': ':'')+'$'+c.parsed.y+(c.parsed.x!=null?' @ '+c.parsed.x+'d':'')}}},scales:{x:{type:'linear',min:0,max:xmax,title:{display:true,text:xl,color:muted},ticks:{color:muted,callback:(v)=>v+'d'},grid:{display:false}},y:{min:0,max:ymax,title:{display:true,text:yl,color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}};}
function seedC1(){c1=new Chart(document.getElementById('c1'),{type:'line',plugins:[bandPlugin],data:{datasets:[{label:'Weekday',data:pts(SEED.weekday),borderColor:COL.weekday,backgroundColor:COL.weekday,borderWidth:2,borderDash:[5,4],tension:.3,pointRadius:3},{label:'Friday out',data:pts(SEED.friday),borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:4},{label:'Saturday out',data:pts(SEED.saturday),borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:4,pointStyle:'rectRot'},{label:'Sunday return',data:pts(SEED.sunday),borderColor:COL.sunday,backgroundColor:COL.sunday,borderWidth:2,tension:.3,pointRadius:4,pointStyle:'triangle'}]},options:baseOpts(95,90,'Days booked before departure','Cheapest coach')});}
function seedC3(){c3=new Chart(document.getElementById('c3'),{type:'line',data:{datasets:[{label:'Sat + Sun',data:pts(SEED.rtSatSun),borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:5,pointStyle:'rectRot'},{label:'Fri + Sun',data:pts(SEED.rtFriSun),borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:5}]},options:baseOpts(70,150,'Days booked before departure','Round-trip total')});}
function initDashboard(){
  seedC1();seedC3();
  document.getElementById('loadBtn').onclick=()=>document.getElementById('csvInput').click();
  document.getElementById('csvInput').onchange=(e)=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{ingest(parseCSV(r.result));}catch(err){document.getElementById('loadStatus').textContent='Could not read file: '+err.message;}};r.readAsText(f);};
  const ls=document.getElementById('timeLeg');if(ls)ls.onchange=buildTimeChart;
}
function parseCSV(txt){const lines=txt.trim().split(/\r?\n/).filter(l=>l.length);const head=lines[0].split(',').map(s=>s.trim());const idx=(n)=>head.indexOf(n);const rows=[];for(let i=1;i<lines.length;i++){const c=lines[i].split(',');const num=(v)=>{v=(v||'').trim();return v===''?null:parseFloat(v);};const txt=(v)=>{v=(v||'').trim();return v===''?null:v;};rows.push({captured:(c[idx('captured_date')]||'').trim(),travel:(c[idx('travel_date')]||'').trim(),dow:(c[idx('day_of_week')]||'').trim(),dir:(c[idx('direction')]||'').trim(),days:num(c[idx('days_ahead')]),low:num(c[idx('lowest_coach_usd')]),seats:num(c[idx('seats_at_lowest')]),next:num(c[idx('next_coach_usd')]),acela:num(c[idx('acela_business_usd')]),ltrain:txt(c[idx('lowest_train')]),ldep:txt(c[idx('lowest_depart')]),sens:num(c[idx('sensible_coach_usd')]),strain:txt(c[idx('sensible_train')]),sdep:txt(c[idx('sensible_depart')])});}return rows.filter(r=>r.low!=null&&r.days!=null&&r.dow);}
const BUCKETS=[[0,9,5],[10,19,15],[20,34,27],[35,49,42],[50,69,60],[70,120,90]];
function bandFor(rows,fare){fare=fare||((r)=>r.low);const out=[];for(const [lo,hi,mid] of BUCKETS){const vals=rows.filter(r=>r.days>=lo&&r.days<=hi).map(fare).sort((a,b)=>a-b);if(!vals.length)continue;out.push({x:mid,med:vals[Math.floor((vals.length-1)/2)],min:vals[0],max:vals[vals.length-1]});}return out;}
function legRows(rows,dow,dir){return rows.filter(r=>r.dow===dow&&r.dir===dir);}
function hexA(hex,a){const n=parseInt(hex.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
function weekendKey(r){const d=new Date(r.travel+'T00:00:00');const off={Fri:1,Sat:0,Sun:-1}[r.dow];if(off==null)return null;d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);}

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
  const draw=()=>{const k=sel.value;const wk=rows.filter(r=>weekendKey(r)===k);const wc=[...new Set(wk.map(r=>r.captured))].sort();const ser=wc.map(cap=>{const s=wk.filter(r=>r.captured===cap);const fri=Math.min(Infinity,...s.filter(r=>r.dow==='Fri').map(fareOf));const sat=Math.min(Infinity,...s.filter(r=>r.dow==='Sat').map(fareOf));const sun=Math.min(Infinity,...s.filter(r=>r.dow==='Sun').map(fareOf));const out=Math.min(fri,sat);return (out<Infinity&&sun<Infinity)?{x:cap,y:out+sun}:null;}).filter(Boolean);const labels=ser.map(p=>p.x),vals=ser.map(p=>p.y);if(c4)c4.destroy();c4=new Chart(document.getElementById('c4'),{type:'line',data:{labels,datasets:[{label:'Cheapest round trip',data:vals,borderColor:'#534ab7',backgroundColor:'rgba(83,74,183,.10)',borderWidth:2,fill:true,tension:.3,pointRadius:4,pointBackgroundColor:'#534ab7',pointBorderColor:'#fff',pointBorderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>'$'+c.parsed.y+' on '+c.label}}},scales:{x:{title:{display:true,text:'Capture date',color:muted},ticks:{color:muted},grid:{display:false}},y:{beginAtZero:false,title:{display:true,text:'Round-trip total ('+(MODE==='sensible'?'sensible':'any train')+')',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});const v=document.getElementById('trajVerdict');if(vals.length){const cur=vals[vals.length-1],min=Math.min(...vals),trend=vals.length>=3?cur-vals[vals.length-3]:0;const cap=(FLOOR+40);let msg,cls;if(cur<=min+3&&cur<=cap){msg='At/near floor — book now.';cls='best';}else if(trend>4){msg='Rising — book soon.';cls='win';}else{msg='Drifting down — okay to wait.';cls='';}v.innerHTML='<span class="'+cls+'">'+msg+'</span> <span style="color:var(--muted)">(now $'+cur+', low $'+min+')</span>';}else v.textContent='';};
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
  // recommendation card
  const head=document.getElementById('recHead'),body=document.getElementById('recBody');
  if(MODE==='sensible'&&bestS){head.textContent='Best bookable round trip: '+bestS.day+' out '+(bestS.tr?'(#'+bestS.tr+' '+bestS.dep+') ':'')+'+ Sunday back, weekend of '+bestS.k+' — about $'+bestS.rt+'.';const floorTxt=(best&&best.rt<bestS.rt)?' The absolute floor is ~$'+best.rt+', but that rides a late-evening train.':'';const fl=bestS.rt<=70;body.innerHTML=(fl?'At/near the practical floor — <b>good to book</b>.':'Still above the practical floor; if your weekend is &gt;2 weeks out, watch a few more days.')+floorTxt+' “Sensible” = outbound 7am–5pm, return 8am–7:30pm.';}
  else if(best){head.textContent='Absolute cheapest round trip: weekend of '+best.k+' — about $'+best.rt+' on any train.';body.innerHTML='This is the rock-bottom fare and often rides a late-evening or early-morning train. Switch to <b>Sensible hours</b> above to see the cheapest trip at usable times'+(bestS?' (~$'+bestS.rt+')':'')+'.';}
}

// in a browser: init charts and auto-load the committed CSV (works on GitHub Pages / any http server); skipped under Node so the pure helpers can be require()d by tests
if(typeof document!=='undefined'){initDashboard();fetch('data/amtrak_fare_log.csv',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('http '+r.status);return r.text();}).then(t=>ingest(parseCSV(t))).catch(()=>{document.getElementById('loadStatus').innerHTML='Auto-load unavailable (opened via file://). Click <b>Load fare log</b> and pick <b>data/amtrak_fare_log.csv</b>.';document.getElementById('metaline').textContent='Showing seed snapshot — load the CSV to go live.';});}
if(typeof module!=='undefined'&&module.exports){module.exports={parseCSV,weekendKey,bandFor};}
