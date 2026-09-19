const money=(v)=>Number.isFinite(v)?'$'+(Math.round(v*100)%100===0?String(Math.round(v)):v.toFixed(2)):'';
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
// All parsing, validation and pairing lives in js/fare-data.js so it can be
// tested headlessly; this file only draws what that layer vouches for.
const FD=(typeof window!=='undefined'&&window.FareData)||(typeof require!=='undefined'?require('./fare-data.js'):null);
let DATA=[],MODE='sensible',FLOOR=20,toggleWired=false;
let FLOOR_N=0,FLOOR_CAPS=0;   // observations and capture days behind FLOOR
// Comparing a price against the log's cheapest-ever fare only means
// something once the log has actually seen a range of prices. Below this
// the page says so instead of calling a fare good or bad.
const MIN_FLOOR_OBS=10,MIN_FLOOR_CAPS=2;
let REPORT=null;          // the full parse result: rows, rejections, provenance
let TODAY=null;           // today in the corridor's timezone, not the viewer's
let STALE=false;          // newest capture is too old to call anything bookable
let c1,c2,c3,c4,c5,c6;
const WINDOWS={out:[7,17],ret:[8,19.5]};           // sensible departure windows (hours)
// A fare is a number or it is missing. Never NaN, never 0 standing in for blank.
const fareOf=(r)=>{const v=(MODE==='sensible'&&r.sens!=null)?r.sens:r.low;return Number.isFinite(v)?v:null;};
const esc=(v)=>String(v==null?'':v).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=(list)=>list.filter(Number.isFinite);
// "$43" / "$43.50" — keeps cents when the log carries them.
const plural=(n,one,many)=>n+' '+(n===1?one:(many||one+'s'));
function parseTime(t){const m=/^(\d{1,2}):(\d{2})([ap])$/.exec((t||'').trim());if(!m)return null;let h=(+m[1])%12;if(m[3]==='p')h+=12;return h+(+m[2])/60;}
function fmtHour(h){let H=Math.round(h)%24;const ap=H<12?'am':'pm';let hh=H%12;if(hh===0)hh=12;return hh+ap;}

const bandPlugin={id:'band',beforeDraw(chart){if(chart.canvas.id!=='c1')return;const {ctx,chartArea:a,scales:{x,y}}=chart;if(!x||!a)return;const x1=x.getPixelForValue(42),x2=x.getPixelForValue(63);ctx.save();ctx.fillStyle=hexA(COL.saturday,0.12);ctx.fillRect(x1,a.top,x2-x1,a.bottom-a.top);ctx.fillStyle=COL.saturday;ctx.font='600 11px sans-serif';ctx.fillText('sweet spot',x1+6,a.top+14);
  // The dashed line is the cheapest fare ever logged — an observation, not a
  // predicted floor — so it is only drawn when there is one.
  if(Number.isFinite(FLOOR)){const yf=y.getPixelForValue(FLOOR);ctx.strokeStyle=muted;ctx.setLineDash([5,4]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.left,yf);ctx.lineTo(a.right,yf);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=muted;ctx.fillText(money(FLOOR)+' observed low',a.left+6,yf-5);}
  ctx.restore();}};
const winPlugin={id:'win',beforeDraw(chart){if(chart.canvas.id!=='c2')return;const {ctx,chartArea:a,scales:{x}}=chart;if(!x||!a)return;const w=chart.$win||WINDOWS.out;const x1=x.getPixelForValue(w[0]),x2=x.getPixelForValue(w[1]);ctx.save();ctx.fillStyle=hexA(COL.saturday,0.10);ctx.fillRect(x1,a.top,x2-x1,a.bottom-a.top);ctx.fillStyle=COL.saturday;ctx.font='600 11px sans-serif';ctx.fillText('sensible window',x1+6,a.top+14);ctx.restore();}};

function baseOpts(xmax,ymax,xl,yl){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>{const p=c.raw||{};const n=p.n!=null?' · '+plural(p.n,'obs','obs')+(p.caps?' from '+plural(p.caps,'capture'):''):'';return (c.dataset.label?c.dataset.label+': ':'')+money(c.parsed.y)+(c.parsed.x!=null?' @ '+c.parsed.x+'d':'')+n;}}}},scales:{x:{type:'linear',min:0,max:xmax,title:{display:true,text:xl,color:muted},ticks:{color:muted,callback:(v)=>v+'d'},grid:{display:false}},y:{min:0,max:ymax,title:{display:true,text:yl,color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}};}
function seedC1(){c1=new Chart(document.getElementById('c1'),{type:'line',plugins:[bandPlugin],data:{datasets:[{label:'Weekday',data:pts(SEED.weekday),borderColor:COL.weekday,backgroundColor:COL.weekday,borderWidth:2,borderDash:[5,4],tension:.3,pointRadius:3},{label:'Friday out',data:pts(SEED.friday),borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:4},{label:'Saturday out',data:pts(SEED.saturday),borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:4,pointStyle:'rectRot'},{label:'Sunday return',data:pts(SEED.sunday),borderColor:COL.sunday,backgroundColor:COL.sunday,borderWidth:2,tension:.3,pointRadius:4,pointStyle:'triangle'}]},options:baseOpts(95,90,'Days booked before departure','Cheapest coach')});}
function seedC3(){c3=new Chart(document.getElementById('c3'),{type:'line',data:{datasets:[{label:'Sat + Sun',data:pts(SEED.rtSatSun),borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:5,pointStyle:'rectRot'},{label:'Fri + Sun',data:pts(SEED.rtFriSun),borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:5}]},options:baseOpts(70,150,'Days booked before departure','Round-trip total')});}
function initDashboard(){
  refreshTheme();
  wireTheme();
  seedC1();seedC3();
  document.getElementById('loadBtn').onclick=()=>document.getElementById('csvInput').click();
  document.getElementById('csvInput').onchange=(e)=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onerror=()=>{ingest({ok:false,error:'The file could not be read from disk.'});};
    r.onload=()=>{
      let result;
      try{result=parseCSV(r.result);}
      catch(err){result={ok:false,error:'The file could not be parsed as a fare log: '+err.message};}
      ingest(result);
      // Let the same file be re-picked after fixing it on disk.
      e.target.value='';
    };
    r.readAsText(f);};
  const ls=document.getElementById('timeLeg');if(ls)ls.onchange=buildTimeChart;
  const as=document.getElementById('acelaLeg');if(as)as.onchange=buildAcela;
}
function syncThemeBtn(){const btn=document.getElementById('themeToggle');if(!btn)return;const dark=document.documentElement.getAttribute('data-theme')==='dark';btn.textContent=dark?'☀️ Light':'🌙 Dark';btn.setAttribute('aria-pressed',dark?'true':'false');}
function wireTheme(){const btn=document.getElementById('themeToggle');if(!btn)return;syncThemeBtn();btn.onclick=()=>{const dark=document.documentElement.getAttribute('data-theme')==='dark';const next=dark?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('amtrak-theme',next);}catch(e){}refreshTheme();syncThemeBtn();if(DATA.length)render();else{if(c1)c1.destroy();if(c3)c3.destroy();seedC1();seedC3();}};}
// parseCSV/weekendKey/bandFor now delegate to the tested trust layer. They stay
// exported under the same names so existing callers and tests keep working.
function parseCSV(txt,opts){return FD.parseCSV(txt,opts);}
const BUCKETS=FD.BUCKETS;
function bandFor(rows,fare){return FD.bandFor(rows,fare);}
function weekendKey(r){return FD.weekendKey(r);}
// A leg is a day AND a direction. Keying on the day alone let a Sunday
// NHV-BOS outbound be summed in as the return leg.
function legRows(rows,dow,dir){return rows.filter(r=>r.dow===dow&&r.dir===dir);}
// Only quotes for trips that have not departed yet can describe what is on sale.
function upcoming(rows){return TODAY==null?rows:rows.filter(r=>r.travel>=TODAY);}
function hexA(hex,a){const n=parseInt(hex.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Formats a YYYY-MM-DD string without ever building a local-midnight Date,
// which is what used to shift every weekend a day west of the dateline.
function shortDate(k){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k||''));return m?MON[+m[2]-1]+' '+(+m[3]):'—';}
function holidayName(satKey){return FD.holidayName(satKey);}

// Per-weekend round trips for the season view, built by the trust layer:
// both legs must come from the SAME capture, and the weekend must not have
// happened yet. Weekends whose legs only ever appeared on different mornings
// are reported as incomplete rather than added together.
function seasonData(rows){
  const weekends=FD.buildWeekends(rows,{fareOf,today:TODAY});
  // pricedWeekends, not bookableWeekends: a weekend whose quote is stale or
  // whose outbound has already departed still belongs in the table as
  // history. It is labelled, never presented as a price you can act on.
  return FD.pricedWeekends(weekends).map(w=>{
    const q=w.latest,seats=[q.out.seats,q.ret.seats].filter(v=>v!=null);
    return {k:w.key,rt:q.rt,outDay:q.out.dow,outTrain:q.out.train,outDep:q.out.depart,
      retTrain:q.ret.train,retDep:q.ret.depart,
      outUnknown:q.out.trainUnknown,retUnknown:q.ret.trainUnknown,
      minSeats:seats.length?Math.min.apply(null,seats):null,
      holiday:w.holiday,asOf:q.captured,ageDays:q.ageDays,stale:q.stale,
      departed:q.departed,departedLeg:q.departedLeg,departsToday:q.departsToday,
      bookable:w.bookable,
      missingLegs:w.missingLegs,captureCount:w.captureCount,sampleCount:w.sampleCount};
  });
}
// Upcoming weekends we could NOT price, and why — shown so a short bar chart
// never reads as "these are the only weekends worth considering".
function seasonGaps(rows){
  const weekends=FD.buildWeekends(rows,{fareOf,today:TODAY});
  return weekends.filter(w=>!w.travelPast&&!w.latest)
    .map(w=>({k:w.key,reason:w.incompleteReason,captureCount:w.captureCount,sampleCount:w.sampleCount}));
}
const seasonLabels={id:'seasonLabels',afterDatasetsDraw(chart){if(chart.canvas.id!=='c6')return;const {ctx,chartArea:a,scales:{y}}=chart;const meta=chart.getDatasetMeta(0),vals=chart.data.datasets[0].data;if(!vals.length)return;const flags=chart.data.datasets[0].bookable||[];const okVals=vals.filter((v,i)=>flags[i]!==false);const minV=okVals.length?Math.min(...okVals):NaN;ctx.save();ctx.font='600 10px sans-serif';ctx.textAlign='center';vals.forEach((v,i)=>{const bar=meta.data[i];if(!bar)return;if(v>y.max){ctx.fillStyle=cssVar('--red')||'#e24b4a';ctx.fillText(money(v),bar.x,a.top+11);}else if(v===minV&&flags[i]!==false){ctx.fillStyle=cssVar('--green')||'#008300';ctx.fillText(money(v),bar.x,bar.y-4);}});ctx.restore();}};

/**
 * Takes the FULL parse result (not just rows) so the page can report what it
 * refused, how old the data is, and what it therefore will not claim.
 */
function ingest(result){
  const status=document.getElementById('loadStatus'),meta=document.getElementById('metaline');
  if(!result||!result.ok){
    const msg=(result&&result.error)||'The file could not be read as a fare log.';
    status.textContent='Could not load the fare log.';
    meta.textContent='No usable fare data — showing the seed snapshot only.';
    showBanner('error','⚠ '+msg.split('\n')[0]);
    clearRec('The fare log could not be read, so nothing on this page is a current price. See <b>Data quality</b> below for the exact reason.');
    renderQuality(result);
    return;
  }
  REPORT=result;
  TODAY=result.stats.today;
  const rows=result.rows,st=result.stats;
  if(!rows.length){
    status.textContent='No usable fare rows found.';
    meta.textContent=st.dataRecords?('All '+plural(st.dataRecords,'row')+' were rejected — showing the seed snapshot only.')
                                   :'The log has a header but no rows yet.';
    showBanner('error','⚠ No usable fare rows'+(st.rejected?' — '+plural(st.rejected,'row')+' rejected, see “Data quality” below.':'.'));
    DATA=[];
    clearRec(st.dataRecords
      ?'Every row in the file was rejected, so there is no observation to base a recommendation on. See <b>Data quality</b> below for why each row was refused.'
      :'The file has a valid header but no fare rows yet.');
    renderQuality(result);return;
  }
  DATA=rows;
  const caps=st.captures,age=st.latestCaptureAgeDays;
  STALE=age==null||age>FD.STALE_AFTER_DAYS;
  const timed=rows.some(r=>r.sens!=null||r.sdep||r.ldep);
  status.innerHTML='<b>'+(STALE?'Archive':'Live')+':</b> '+plural(rows.length,'fare')+' · '+plural(caps.length,'capture day')+' · '+esc(caps[0])+' → '+esc(caps[caps.length-1])+
    (st.rejected?' · <span class="scarce">'+plural(st.rejected,'row')+' rejected</span>':'');
  meta.textContent=(STALE?'Historical fare log':'Live from fare log')+' · '+plural(rows.length,'sample')+
    ' · captures '+caps[0]+'–'+caps[caps.length-1]+(timed?' · time-aware':'');

  if(STALE){
    showBanner('stale','⚠ Newest capture is '+esc(caps[caps.length-1])+' ('+(age==null?'unknown age':plural(age,'day')+' ago')+
      ') — the daily tracker may have stopped. Prices below are what was on sale then, not what you can book now.');
  }else showBanner(null);
  wireToggle();
  render();
  renderQuality(result);
}

/**
 * Blank the recommendation. Without this the card kept whatever it last said
 * - including the page's own pre-load example - while the status line
 * underneath reported that the log could not be read, so a failed load still
 * read as an instruction to buy a specific trip at a specific price.
 */
function clearRec(msg){
  const head=document.getElementById('recHead'),body=document.getElementById('recBody');
  if(head)head.textContent='No recommendation \u2014 no usable fare data.';
  if(body)body.innerHTML=msg;
}

function showBanner(kind,html){
  const sb=document.getElementById('staleBanner');if(!sb)return;
  if(!kind){sb.style.display='none';sb.innerHTML='';return;}
  sb.style.display='block';sb.innerHTML=html;
}

/** Provenance panel: what was loaded, what was refused, and why. */
function renderQuality(result){
  const box=document.getElementById('qualityBox');if(!box)return;
  if(!result){box.className='placeholder';box.textContent='No fare log loaded.';return;}
  if(!result.ok){
    box.className='';
    box.innerHTML='<p><b>The fare log could not be read.</b></p><pre class="reason">'+esc(result.error)+'</pre>';
    return;
  }
  const st=result.stats;
  box.className='';
  let h='<table><tr><th>Measure</th><th>Value</th></tr>';
  h+='<tr><td>Rows in file</td><td class="num">'+st.dataRecords+'</td></tr>';
  h+='<tr><td>Accepted observations</td><td class="num">'+st.accepted+'</td></tr>';
  h+='<tr><td>Rejected as malformed</td><td class="num'+(st.malformed?' scarce':'')+'">'+st.malformed+'</td></tr>';
  h+='<tr><td>Excluded — not a weekend out-and-back leg</td><td class="num">'+st.offPattern+'</td></tr>';
  h+='<tr><td>Duplicate captures collapsed</td><td class="num">'+st.duplicates+'</td></tr>';
  h+='<tr><td>Capture days</td><td class="num">'+st.captures.length+'</td></tr>';
  h+='<tr><td>Newest capture</td><td class="num">'+esc(st.latestCapture||'—')+(st.latestCaptureAgeDays!=null?' <span style="color:var(--muted)">('+plural(st.latestCaptureAgeDays,'day')+' ago)</span>':'')+'</td></tr>';
  h+='<tr><td>Today (America/New_York)</td><td class="num">'+esc(st.today)+'</td></tr>';
  h+='</table>';
  if(result.rejected.length){
    const shown=result.rejected.slice(0,12);
    h+='<details style="margin-top:10px"><summary>Why '+plural(result.rejected.length,'row')+' '+(result.rejected.length===1?'was':'were')+' not used</summary><ul class="reasons">';
    shown.forEach(r=>{h+='<li><b>line '+r.line+'</b> — '+esc(r.reasons.join('; '))+'</li>';});
    if(result.rejected.length>shown.length)h+='<li>… and '+(result.rejected.length-shown.length)+' more</li>';
    h+='</ul></details>';
  }
  if(result.duplicates.length){
    h+='<details style="margin-top:6px"><summary>'+plural(result.duplicates.length,'duplicate capture')+' collapsed</summary><ul class="reasons">';
    result.duplicates.slice(0,12).forEach(d=>{h+='<li><b>line '+d.line+'</b> supersedes line '+d.supersedes+(d.changed?' <span class="scarce">(the fare changed)</span>':' (identical)')+'</li>';});
    h+='</ul></details>';
  }
  h+='<p class="note">A blank cell means “not observed”, never $0. Rows are only used when the dates are real, the capture is not in the future, the travel date is on or after the capture, <code>days_ahead</code> agrees with both dates, and the day/direction form a weekend out-and-back leg.</p>';
  box.innerHTML=h;
}
function wireToggle(){if(toggleWired)return;const t=document.getElementById('modeToggle');if(!t)return;t.querySelectorAll('.segbtn').forEach(btn=>{btn.onclick=()=>{if(btn.dataset.mode===MODE)return;MODE=btn.dataset.mode;render();};});toggleWired=true;}
function syncToggleUI(){const t=document.getElementById('modeToggle');if(!t)return;t.querySelectorAll('.segbtn').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===MODE));const hint=document.getElementById('modeHint');if(hint)hint.textContent=MODE==='sensible'?'Fares for trains at usable hours (out 7am–5pm · back 8am–7:30pm).':'Absolute cheapest seat on any train — the floor often rides a late-evening train.';}

function render(){
  const rows=DATA;if(!rows.length)return;
  const caps=[...new Set(rows.map(r=>r.captured))].sort();const latest=caps[caps.length-1];
  const fares=finite(rows.map(fareOf));
  FLOOR_N=fares.length;FLOOR_CAPS=caps.length;
  // The reference line is the cheapest fare actually observed. It used to be
  // Math.min(20, ...), which pinned a $20 "floor" from the seed data onto logs
  // that had never seen anything near it.
  FLOOR=fares.length?Math.min.apply(null,fares):null;
  syncToggleUI();
  // 1 · fare vs lead time (mode-aware bands)
  const legs=[['Fri','NHV-BOS',COL.friday],['Sat','NHV-BOS',COL.saturday],['Sun','BOS-NHV',COL.sunday]];
  const ds=[{label:'Weekday (seed)',data:pts(SEED.weekday),borderColor:COL.weekday,backgroundColor:COL.weekday,borderWidth:2,borderDash:[5,4],tension:.3,pointRadius:2}];
  legs.forEach(([dow,dir,col])=>{const b=bandFor(legRows(rows,dow,dir),fareOf);if(!b.length)return;const rgba=hexA(col,0.13);ds.push({label:dow+' max',data:b.map(p=>({x:p.x,y:p.max})),borderColor:'transparent',backgroundColor:rgba,pointRadius:0,fill:'+1',tension:.3});ds.push({label:dow+' min',data:b.map(p=>({x:p.x,y:p.min})),borderColor:'transparent',backgroundColor:rgba,pointRadius:0,fill:false,tension:.3});
    // A single-observation point is drawn hollow so a "median" of one sample
    // does not look like a settled number.
    ds.push({label:dow+' median',data:b.map(p=>({x:p.x,y:p.med,n:p.n,caps:p.captures})),borderColor:col,backgroundColor:b.map(p=>p.n>=3?col:'transparent'),borderWidth:2,tension:.3,pointRadius:4,pointBorderColor:col,pointBorderWidth:2});});
  const ymax=Math.max(90,...finite(rows.map(fareOf)))+8;
  c1.destroy();c1=new Chart(document.getElementById('c1'),{type:'line',plugins:[bandPlugin],data:{datasets:ds},options:baseOpts(95,ymax,'Days booked before departure','Cheapest coach ('+(MODE==='sensible'?'sensible hours':'any train')+')')});
  const sampleNote=document.getElementById('bandNote');
  if(sampleNote){const per=legs.map(([dow,dir])=>{const b=bandFor(legRows(rows,dow,dir),fareOf);const n=b.reduce((s,p)=>s+p.n,0);return dow+' '+n;}).join(' · ');
    sampleNote.textContent='Observations behind the bands: '+per+'. Hollow points rest on fewer than 3 observations. Bands are min–max of what was logged, not a confidence interval.';}
  rebuildRT(rows,latest);
  forecast(rows);
  buildTrajectory(rows);
  buildScarcity(rows,latest);
  buildKPIs(rows,latest);
  buildTimeChart();
  buildAcela();
  buildSeason(rows);
}

// Season view: cheapest bookable round-trip per weekend across the horizon, + a ranking table
function buildSeason(rows){
  const data=seasonData(rows);
  const chartEl=document.getElementById('c6'),tableEl=document.getElementById('seasonTable');
  if(!data.length){
    if(c6){c6.destroy();c6=null;}
    const gaps=seasonGaps(rows);
    let msg='<div class="placeholder">No upcoming weekend has both an outbound and a Sunday return from the same capture.';
    if(gaps.length){msg+='<ul class="reasons">';gaps.slice(0,8).forEach(g=>{msg+='<li><b>'+shortDate(g.k)+'</b> — '+esc(g.reason)+'</li>';});
      if(gaps.length>8)msg+='<li>… and '+(gaps.length-8)+' more</li>';msg+='</ul>';}
    else msg+=' Every weekend in the log has already passed.';
    msg+='</div>';
    if(tableEl)tableEl.innerHTML=msg;return;}
  const green=cssVar('--green')||'#008300',red=cssVar('--red')||'#e24b4a';
  const byDate=[...data].sort((a,b)=>a.k<b.k?-1:1);
  const labels=byDate.map(w=>shortDate(w.k)),vals=byDate.map(w=>w.rt),colors=byDate.map(w=>w.holiday?red:green);
  const anyStaleQuote=byDate.some(w=>w.stale);
  const anyDeparted=byDate.some(w=>w.departed);
  // The headline only promises bookability when every row shown is bookable.
  const allBookable=byDate.every(w=>w.bookable);
  const nonHol=byDate.filter(w=>!w.holiday).map(w=>w.rt);
  const ymax=Math.max(90,...(nonHol.length?nonHol:vals))+18;
  if(c6)c6.destroy();
  c6=new Chart(chartEl,{type:'bar',plugins:[seasonLabels],data:{labels,datasets:[{label:'Cheapest round trip',data:vals,bookable:byDate.map(w=>w.bookable),backgroundColor:colors,borderRadius:4,maxBarThickness:38}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>{const w=byDate[c.dataIndex];return money(w.rt)+(w.holiday?' · '+w.holiday:'')+' · '+(w.outDay||'')+' out '+(w.outTrain?'#'+w.outTrain+' ':'')+(w.outDep||'')+' · as of '+w.asOf+(w.stale?' (stale)':'')+(w.departed?' · '+w.departedLeg+' outbound already departed':'');}}}},scales:{x:{ticks:{color:muted,maxRotation:60,minRotation:45},grid:{display:false}},y:{min:0,max:ymax,title:{display:true,text:(allBookable?'Bookable round trip':'Last seen round trip')+' ('+(MODE==='sensible'?'sensible':'any train')+')',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});
  const rank=[...data].sort((a,b)=>a.rt-b.rt);
  const caps=[...new Set(data.map(w=>w.asOf))].sort();
  const priceHead=allBookable?'Bookable RT':'Last seen RT';
  let h='<div style="overflow-x:auto"><table><tr><th>#</th><th>Weekend</th><th>'+priceHead+'</th><th>Outbound</th><th>Return</th><th>Seats</th><th>As of</th><th></th></tr>';
  rank.forEach((w,i)=>{
    const scarce=w.minSeats!=null&&w.minSeats<=2;
    const unk=' <span style="color:var(--muted)" title="this fare’s train was not logged">train n/a</span>';
    const outTxt=esc(w.outDay||'—')+(w.outTrain?' #'+esc(w.outTrain):'')+(w.outDep?' '+esc(w.outDep):'')+(w.outUnknown?unk:'');
    const retTxt='Sun'+(w.retTrain?' #'+esc(w.retTrain):'')+(w.retDep?' '+esc(w.retDep):'')+(w.retUnknown?unk:'');
    const asOf=shortDate(w.asOf)+(w.stale?' <span class="scarce" title="'+esc(plural(w.ageDays,'day'))+' old">·stale</span>':'');
    const partial=w.missingLegs.length?' <span style="color:var(--muted)" title="no '+esc(w.missingLegs.join('/'))+' leg logged for this weekend">·'+esc(w.missingLegs.join('/'))+' n/a</span>':'';
    // A trip whose outbound has already run cannot be bought at any price.
    const gone=w.departed?' <span class="scarce" title="the '+esc(w.departedLeg||'outbound')+' leg has already travelled">·departed</span>':(w.departsToday?' <span class="scarce" title="the outbound travels today and may already have left">·departs today</span>':'');
    h+='<tr><td class="num">'+(i+1)+'</td><td>'+shortDate(w.k)+partial+gone+'</td><td class="num'+(i===0&&w.bookable?' best':'')+'">'+money(w.rt)+'</td><td>'+outTxt+'</td><td>'+retTxt+'</td>'+
      '<td class="num '+(scarce?'scarce':'')+'">'+(w.minSeats!=null?w.minSeats+(scarce?' ⚠':''):'—')+'</td>'+
      '<td style="color:var(--muted)">'+asOf+'</td><td>'+(w.holiday?'<span class="pill">'+esc(w.holiday)+'</span>':'')+'</td></tr>';});
  h+='</table></div>';

  // Weekends we could not price belong next to the ones we could, or a short
  // chart reads as "these are the only weekends available".
  const gaps=seasonGaps(rows);
  if(gaps.length){
    h+='<details style="margin-top:8px"><summary>'+plural(gaps.length,'upcoming weekend')+' could not be priced</summary><ul class="reasons">';
    gaps.slice(0,15).forEach(g=>{h+='<li><b>'+shortDate(g.k)+'</b> — '+esc(g.reason)+' ('+plural(g.sampleCount,'observation')+')</li>';});
    if(gaps.length>15)h+='<li>… and '+(gaps.length-15)+' more</li>';
    h+='</ul></details>';
  }
  h+='<p class="note">One row per upcoming weekend that has an outbound <b>and</b> a Sunday return <b>from the same capture</b> — legs seen on different mornings are never added together. '+
    (anyStaleQuote?'<b>Prices marked ·stale come from a capture more than '+FD.STALE_AFTER_DAYS+' days old and are historical, not bookable.</b> ':'')+(anyDeparted?'<b>Prices marked ·departed include a leg that has already travelled — that round trip can no longer be bought at any price.</b> ':'')+
    'As-of column shows the capture behind each price ('+(caps.length>1?caps.map(shortDate).join(' & '):shortDate(caps[0]))+'). ⚠ = ≤2 seats left at the lowest price on a leg; a blank means seats-left was not shown, not zero. Holiday weekends can be far pricier — see the badge.</p>';
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

/**
 * Round-trip totals against lead time, from the latest capture.
 *
 * Three things changed here. Legs are matched on day AND direction, so a
 * Sunday outbound can no longer be added in as a return. A Fri+Sun weekend is
 * plotted even when no Saturday was logged (it used to be dropped, because the
 * x value came from the Saturday row). And each series carries its own
 * outbound lead time rather than borrowing Saturday's.
 */
function rebuildRT(rows,latest){
  const lr=upcoming(rows).filter(r=>r.captured===latest);
  const byWk={};
  lr.forEach(r=>{const k=weekendKey(r);if(!k)return;const f=fareOf(r);if(f==null)return;
    const o=byWk[k]=byWk[k]||{};
    if(r.leg==='ret'&&r.dow==='Sun'){if(o.Sun==null||f<o.Sun)o.Sun=f;}
    else if(r.leg==='out'&&(r.dow==='Fri'||r.dow==='Sat')){
      const cur=o[r.dow];if(cur==null||f<cur.f)o[r.dow]={f,days:r.days};}});
  const satPts=[],friPts=[];
  Object.values(byWk).forEach(o=>{
    if(o.Sun==null)return;                                   // no return leg: no round trip
    if(o.Sat)satPts.push({x:o.Sat.days,y:FD.sumOrNull([o.Sat.f,o.Sun])});
    if(o.Fri)friPts.push({x:o.Fri.days,y:FD.sumOrNull([o.Fri.f,o.Sun])});
  });
  const keep=(p)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
  const sat=satPts.filter(keep).sort((a,b)=>a.x-b.x),fri=friPts.filter(keep).sort((a,b)=>a.x-b.x);
  const xmax=Math.max(70,...sat.map(p=>p.x),...fri.map(p=>p.x))+5;
  const ymax=Math.max(150,...sat.map(p=>p.y),...fri.map(p=>p.y))+10;
  c3.destroy();c3=new Chart(document.getElementById('c3'),{type:'line',data:{datasets:[{label:'Sat + Sun',data:sat,borderColor:COL.saturday,backgroundColor:COL.saturday,borderWidth:2,tension:.3,pointRadius:5,pointStyle:'rectRot'},{label:'Fri + Sun',data:fri,borderColor:COL.friday,backgroundColor:COL.friday,borderWidth:2,tension:.3,pointRadius:5}]},options:baseOpts(xmax,ymax,'Days before the outbound leg','Round-trip total ('+(MODE==='sensible'?'sensible':'any train')+')')});
  const note=document.getElementById('rtNote');
  if(note){
    note.textContent=(sat.length||fri.length)
      ?'From the capture of '+latest+(STALE?' (stale — historical, not bookable)':'')+': '+plural(sat.length,'Sat+Sun weekend')+', '+plural(fri.length,'Fri+Sun weekend')+'. Both legs of every point come from that one capture.'
      :'No weekend in the latest capture had both an outbound and a Sunday return still ahead of today.';
  }
}

/**
 * Floor forecast — the same model as before, but it now has to earn the right
 * to print a number.
 *
 * It used to fit an exponential to as few as 3 lead times from a single
 * morning, print the observed minimum under the heading "Modeled floor", and
 * recommend a booking window from it. Now the observed low is labelled as an
 * observation, the fit is only published when it has enough distinct lead
 * times, more than one capture day, a wide enough span and an R² that says the
 * curve actually describes the prices — and when it doesn't, the row says why.
 */
function forecast(rows){
  const box=document.getElementById('forecastBox');
  const src=upcoming(rows);
  const legs=[['Friday out','Fri','NHV-BOS',COL.friday],['Saturday out','Sat','NHV-BOS',COL.saturday],['Sunday return','Sun','BOS-NHV',COL.sunday]];
  // No "Modeled floor" column: the model's floor term is seeded from the
  // observed minimum, so printing it beside "Observed low" showed the same
  // number twice and read as the model independently confirming the floor.
  let html='<table><tr><th>Leg</th><th>Observed low</th><th>Lead-time effect</th><th>Fit</th></tr>';
  let anyFit=false,anyLeg=false;
  legs.forEach(([name,dow,dir,col])=>{
    const lr=legRows(src,dow,dir);
    const pts=lr.map(r=>({days:r.days,fare:fareOf(r),captured:r.captured})).filter(p=>Number.isFinite(p.fare));
    const fit=FD.fitFloor(pts);
    const label='<td><span style="color:'+col+'">●</span> '+esc(name)+'</td>';
    if(!pts.length){html+='<tr>'+label+'<td colspan="3" style="color:var(--muted)">no observations for this leg</td></tr>';return;}
    anyLeg=true;
    const low='<td class="num">'+money(fit.observedLow)+'</td>';
    if(fit.ok){
      anyFit=true;
      html+='<tr>'+label+low+'<td>'+esc(fit.bookBy)+'</td>'+
        '<td class="num">R²&nbsp;'+fit.r2.toFixed(2)+' · '+plural(fit.n,'lead time')+' · '+plural(fit.captureCount,'capture')+'</td></tr>';
    }else{
      html+='<tr>'+label+low+'<td colspan="2" style="color:var(--muted)">not modelled — '+esc(fit.reason)+'</td></tr>';
    }
  });
  html+='</table>';
  box.className=anyLeg?'':'placeholder';
  if(!anyLeg){box.innerHTML='No upcoming legs in the log yet — load a fare log with travel dates still ahead.';return;}
  let note;
  if(anyFit){
    note='Model: fare = floor + A·e<sup>−k·days-ahead</sup>, least squares on '+(MODE==='sensible'?'sensible-hour':'absolute-lowest')+' points, one point per lead time. '+
      'Published only at ≥'+FD.MIN_LEAD_POINTS+' lead times across ≥'+FD.MIN_FIT_CAPTURES+' capture days spanning ≥'+FD.MIN_FIT_SPAN_DAYS+' days, with R²&nbsp;≥&nbsp;'+FD.MIN_FIT_R2.toFixed(2)+'.';
  }else{
    note='No leg has enough evidence to model a floor yet, so none is shown. “Observed low” is simply the cheapest fare logged for that leg — a past observation, not a prediction.';
  }
  if(STALE)note+=' <b>The log is stale, so even a published fit describes prices that are no longer on sale.</b>';
  box.innerHTML=html+'<p class="note">'+note+'</p>';
}

/**
 * One weekend's round-trip total over successive captures.
 *
 * Each point is a single capture that saw both an outbound and the Sunday
 * return; a capture missing a leg produces no point instead of a partial
 * total. (It used to fold a missing leg in via Math.min(Infinity, ...null),
 * which coerces to 0 and quietly halves the round trip.)
 */
function buildTrajectory(rows){
  const weekends=FD.buildWeekends(rows,{fareOf,today:TODAY});
  const sel=document.getElementById('trajSelect');const prev=sel.value;sel.innerHTML='';
  weekends.forEach(w=>{const o=document.createElement('option');o.value=w.key;
    o.textContent='Weekend of Sat '+w.key+(w.travelPast?' (past)':'')+(w.quotes.length?'':' — no paired quote');
    sel.appendChild(o);});
  const keys=weekends.map(w=>w.key);
  if(prev&&keys.indexOf(prev)>=0)sel.value=prev;
  else{const firstLive=weekends.find(w=>!w.travelPast&&w.quotes.length>1)||weekends.find(w=>w.quotes.length>1);if(firstLive)sel.value=firstLive.key;}

  const caps=[...new Set(rows.map(r=>r.captured))].sort();
  const ph=document.getElementById('trajPlaceholder');
  if(caps.length<2){ph.style.display='block';ph.textContent='Needs ≥2 capture days to draw a trajectory — the log has '+plural(caps.length,'capture day')+'.';document.getElementById('trajControls').style.display='none';document.getElementById('trajBox').style.display='none';return;}
  ph.style.display='none';document.getElementById('trajControls').style.display='block';document.getElementById('trajBox').style.display='block';

  const draw=()=>{
    const w=weekends.find(x=>x.key===sel.value)||weekends[0];
    const ser=w?w.quotes:[];
    const labels=ser.map(p=>p.captured),vals=ser.map(p=>p.rt);
    if(c4)c4.destroy();
    c4=new Chart(document.getElementById('c4'),{type:'line',data:{labels,datasets:[{label:'Cheapest round trip',data:vals,borderColor:VIOLET,backgroundColor:hexA(VIOLET,0.10),borderWidth:2,fill:true,tension:.3,pointRadius:4,pointBackgroundColor:VIOLET,pointBorderColor:cssVar('--card')||'#fff',pointBorderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>money(c.parsed.y)+' on '+c.label}}},scales:{x:{title:{display:true,text:'Capture date',color:muted},ticks:{color:muted},grid:{display:false}},y:{beginAtZero:false,title:{display:true,text:'Round-trip total ('+(MODE==='sensible'?'sensible':'any train')+')',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});
    const v=document.getElementById('trajVerdict');if(!v)return;
    if(!w||!vals.length){v.innerHTML='<span style="color:var(--muted)">'+esc(w?(w.incompleteReason||'no paired quote for this weekend'):'no weekend selected')+'</span>';return;}
    const cur=vals[vals.length-1],min=Math.min.apply(null,vals);
    const tail='<span style="color:var(--muted)"> (latest '+money(cur)+' on '+esc(labels[labels.length-1])+', low '+money(min)+' over '+plural(vals.length,'capture')+')</span>';
    // A booking verdict is a claim about what you can buy right now. It is only
    // offered when the trip is still ahead, the quote is fresh, and there are
    // enough captures to see a direction.
    if(w.travelPast){v.innerHTML='<span style="color:var(--muted)">This weekend has passed — historical prices only.</span>'+tail;return;}
    if(w.latest&&w.latest.stale){v.innerHTML='<span style="color:var(--muted)">Last seen '+plural(w.latest.ageDays,'day')+' ago — too old to call.</span>'+tail;return;}
    if(vals.length<3){v.innerHTML='<span style="color:var(--muted)">'+plural(vals.length,'capture')+' — not enough to call a direction.</span>'+tail;return;}
    const trend=cur-vals[vals.length-3];
    let msg,cls;
    if(cur<=min+3){msg='At/near the low seen so far — good time to book.';cls='best';}
    else if(trend>4){msg='Rising — book soon.';cls='win';}
    else{msg='Drifting down — okay to wait.';cls='';}
    v.innerHTML='<span class="'+cls+'">'+msg+'</span>'+tail;
  };
  sel.onchange=draw;draw();
}

// Seats-left is a claim about what is on sale, so departed trips are excluded
// and a stale capture is labelled rather than presented as current.
function buildScarcity(rows,latest){
  const box=document.getElementById('scarcityBox');
  const lr=upcoming(rows).filter(r=>r.captured===latest&&r.seats!=null).sort((a,b)=>a.seats-b.seats);
  if(!lr.length){box.className='placeholder';
    box.textContent=rows.some(r=>r.captured===latest&&r.seats!=null)
      ?'The latest capture ('+latest+') has seats-left data, but only for trips that have already departed.'
      :'Latest capture had no seats-left data.';
    return;}
  box.className='';
  let h='<table><tr><th>Travel date</th><th>Leg</th><th>Lowest</th><th>Train</th><th>Seats</th><th>Next</th></tr>';
  lr.slice(0,10).forEach(r=>{const s=r.seats<=2;const tr=(r.ltrain?('#'+esc(r.ltrain)+(r.ldep?' · '+esc(r.ldep):'')):'—');
    h+='<tr><td>'+esc(r.travel)+' ('+esc(r.dow)+')</td><td>'+esc(r.dir)+'</td><td class="num">'+money(r.low)+'</td><td>'+tr+'</td><td class="num '+(s?'scarce':'')+'">'+r.seats+(s?' ⚠':'')+'</td><td class="num">'+(r.next!=null?money(r.next):'—')+'</td></tr>';});
  h+='</table><p class="note">'+(STALE?'<b>Captured '+esc(latest)+', '+plural(REPORT.stats.latestCaptureAgeDays,'day')+' ago — seat counts this old are not current.</b> ':'From the capture of '+esc(latest)+'. ')+
    '⚠ = ≤2 seats at the lowest price; expect a jump to the next price. Trips that have already departed are excluded. A blank “Next” means no higher price was observed, not $0.</p>';
  box.innerHTML=h;}

// 4 · fare by departure time — real logged trains, sensible window shaded, filter by leg
function buildTimeChart(){
  const rows=DATA;if(!rows||!rows.length)return;
  const legSel=document.getElementById('timeLeg');const leg=legSel?legSel.value:'all';
  const filt=rows.filter(r=>leg==='all'||r.dow===leg);
  const byDay={Fri:[],Sat:[],Sun:[]};
  filt.forEach(r=>{const seen=new Set();[[r.ldep,r.low,r.ltrain],[r.sdep,r.sens,r.strain]].forEach(([d,f,t])=>{if(!d||f==null)return;const h=parseTime(d);if(h==null)return;const key=t||d;if(seen.has(key))return;seen.add(key);(byDay[r.dow]||(byDay[r.dow]=[])).push({x:h,y:f,train:t,dep:d,days:r.days,travel:r.travel,dow:r.dow,captured:r.captured});});});
  const style={Fri:'circle',Sat:'rectRot',Sun:'triangle'};
  const datasets=Object.entries(byDay).filter(([,pts])=>pts.length).map(([dow,pts])=>({label:dow,data:pts,borderColor:DAYCOL[dow],backgroundColor:hexA(DAYCOL[dow],0.65),pointStyle:style[dow],pointRadius:5,pointHoverRadius:7}));
  const note=document.getElementById('timeNote');
  if(!datasets.length){if(c2){c2.destroy();c2=null;}if(note)note.textContent='No departure-time data logged yet for this leg.';return;}
  const win=leg==='Sun'?WINDOWS.ret:WINDOWS.out;
  const allF=datasets.flatMap(d=>d.data.map(p=>p.y));const ymax=Math.max(...allF)+15;
  if(c2)c2.destroy();
  c2=new Chart(document.getElementById('c2'),{type:'scatter',plugins:[winPlugin],data:{datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'bottom',labels:{color:muted,usePointStyle:true,boxWidth:8}},tooltip:{callbacks:{label:(c)=>{const p=c.raw;return money(p.y)+' · '+p.dow+' '+(p.train?'#'+p.train+' ':'')+fmtHour(p.x)+' · '+p.days+'d ahead · captured '+p.captured;}}}},scales:{x:{type:'linear',min:0,max:24,title:{display:true,text:'Departure time',color:muted},ticks:{color:muted,stepSize:3,callback:(v)=>fmtHour(v)},grid:{color:grid}},y:{min:0,max:ymax,title:{display:true,text:'Coach fare',color:muted},ticks:{color:muted,callback:money},grid:{color:grid}}}}});
  c2.$win=win;c2.update();
  if(note)note.textContent='Shaded = usable hours ('+fmtHour(win[0])+'–'+fmtHour(win[1])+'). Points outside it — mostly the cheapest fares — ride early-morning or late-evening trains.';
}

/**
 * Headline numbers and the booking recommendation.
 *
 * Every figure here is a claim about what you can buy, so it is built only
 * from weekends that (a) have not departed, and (b) have an outbound and a
 * Sunday return from the SAME capture. When the newest capture is stale the
 * card stops recommending and starts reporting history.
 */
function buildKPIs(rows,latest){
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  const setH=(id,v)=>{const e=document.getElementById(id);if(e)e.innerHTML=v;};

  // Two passes over the same weekends, one per fare basis, so the "absolute
  // floor" KPI stays meaningful whichever basis the toggle is on.
  const sensibleFare=FD.makeFareAccessor('sensible'),absoluteFare=FD.makeFareAccessor('absolute');
  const pick=(accessor)=>{
    const live=FD.buildWeekends(rows,{fareOf:accessor,today:TODAY})
      .filter(w=>!w.travelPast&&w.latest&&w.latest.captured===latest&&!w.latest.departed);
    let best=null;
    live.forEach(w=>{const q=w.latest;if(!best||q.rt<best.rt)best={k:w.key,rt:q.rt,out:q.out,ret:q.ret,captured:q.captured,ageDays:q.ageDays,departsToday:q.departsToday};});
    return {best,count:live.length};
  };
  const S=pick(sensibleFare),A=pick(absoluteFare);
  const bestS=S.best,best=A.best;
  const lr=upcoming(rows).filter(r=>r.captured===latest);
  const suffix=STALE?' · as of '+latest:'';

  // KPI 1: cheapest paired round trip at usable hours
  if(bestS){set('kpiCheapRT',money(bestS.rt));
    const trip=[bestS.out.train?'#'+bestS.out.train:'',bestS.out.depart||''].filter(Boolean).join(' ');
    setH('kpiCheapFoot',esc(bestS.out.dow)+' out'+(trip?' ('+esc(trip)+')':'')+' · wknd '+esc(bestS.k)+esc(suffix));}
  else{set('kpiCheapRT','—');set('kpiCheapFoot',upcoming(rows).length?'no upcoming weekend has both legs in one capture':'no upcoming travel dates in the log');}

  // KPI 2: the same trip on any train, including late-night departures
  if(best){set('kpiFloorRT',money(best.rt));setH('kpiFloorFoot',(bestS&&best.rt<bestS.rt)?'on a late-evening train':'same as bookable');}
  else{set('kpiFloorRT','—');set('kpiFloorFoot','—');}

  // KPI 3: late-train "tax" = mean (sensible − absolute) across legs that have both
  const both=lr.filter(r=>r.sens!=null&&r.low!=null);
  const gaps=both.filter(r=>r.sens>r.low).map(r=>r.sens-r.low);
  if(gaps.length){const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;set('kpiTax',money(Math.round(avg)));
    setH('kpiTaxFoot',gaps.length+' of '+plural(both.length,'comparable leg')+' cheaper on a late train'+esc(suffix));}
  else if(both.length){set('kpiTax',money(0));set('kpiTaxFoot','cheapest train already daytime on all '+both.length);}
  else{set('kpiTax','—');set('kpiTaxFoot','no leg logs both a lowest and a sensible fare');}

  // KPI 4: booking-early saving, only when both ends of the comparison are real
  const b=bandFor(upcoming(rows),fareOf);
  let pct=null,near=null,far=null;
  if(b.length>=2){near=b[0],far=b[b.length-1];if(near.med>0)pct=Math.round((near.med-far.med)/near.med*100);}
  const thin=near&&far&&(near.n<3||far.n<3);
  set('kpiEarly',pct!=null&&pct>0?'~'+pct+'%':'—');
  setH('kpiEarlyFoot',pct!=null
    ?'book ~'+far.x+'d vs ~'+near.x+'d out · '+plural(far.n,'obs','obs')+' vs '+plural(near.n,'obs','obs')+(thin?' <span class="scarce">(thin)</span>':'')
    :'need lead times at both ends');

  // KPI 5: Acela Business premium over the coach fare you would otherwise book
  const aps=lr.filter(r=>r.acela!=null).map(r=>{const c=r.sens!=null?r.sens:r.low;return c!=null?r.acela-c:null;}).filter(v=>v!=null&&v>0);
  if(aps.length){const avg=aps.reduce((a,b)=>a+b,0)/aps.length;set('kpiAcela','+'+money(Math.round(avg)));setH('kpiAcelaFoot','avg Business over coach ('+plural(aps.length,'leg')+')'+esc(suffix));}
  else{set('kpiAcela','—');set('kpiAcelaFoot','no Acela data logged');}

  // ---- recommendation card -------------------------------------------------
  const head=document.getElementById('recHead'),body=document.getElementById('recBody');
  const basisNote=' “Sensible” = outbound 7am–5pm, return 8am–7:30pm.';
  const target=(MODE==='sensible'&&bestS)?bestS:best;
  if(!target){
    head.textContent='No bookable weekend to recommend.';
    body.innerHTML=REPORT&&REPORT.rows.length
      ?'The log has '+plural(REPORT.rows.length,'observation')+', but no weekend still ahead of '+esc(TODAY)+' has an outbound and a Sunday return from the same capture. See <b>Data quality</b> below for what was excluded and why.'
      :'Load a fare log to see a recommendation.';
    return;
  }
  const trip=target.out.train?'(#'+esc(target.out.train)+(target.out.depart?' '+esc(target.out.depart):'')+') ':'';
  if(STALE){
    // Historical prices must never be phrased as an instruction to book.
    head.textContent='Last observed cheapest round trip: '+target.out.dow+' out + Sunday back, weekend of '+target.k+' — '+money(target.rt)+'.';
    body.innerHTML='<b>This is history, not an offer.</b> It comes from the capture of '+esc(latest)+', '+plural(REPORT.stats.latestCaptureAgeDays,'day')+
      ' ago; Amtrak fares move daily, so this trip is very unlikely to still be at this price. Re-run the tracker before booking anything.'+
      (MODE==='sensible'?basisNote:'');
    return;
  }
  if(MODE==='sensible'&&bestS){
    head.textContent='Best bookable round trip: '+bestS.out.dow+' out '+(target.out.train?'(#'+bestS.out.train+(bestS.out.depart?' '+bestS.out.depart:'')+') ':'')+'+ Sunday back, weekend of '+bestS.k+' — about '+money(bestS.rt)+'.';
    const floorTxt=(best&&best.rt<bestS.rt)?' The cheapest seat on any train is '+money(best.rt)+', but that rides a late-evening or early-morning departure.':'';
    // Only compare against a floor the data supports.
    const grounded=Number.isFinite(FLOOR)&&FLOOR_N>=MIN_FLOOR_OBS&&FLOOR_CAPS>=MIN_FLOOR_CAPS;
    const evidence=' (against '+plural(FLOOR_N,'observation')+' across '+plural(FLOOR_CAPS,'capture day')+')';
    const cmp=grounded
      ?(bestS.rt<=FLOOR*2+10?'At or near the cheapest round trip this log has seen'+evidence+' — <b>good to book</b>.'
                            :'Above the cheapest round trip this log has seen ('+money(FLOOR)+' per leg)'+evidence+'; if your weekend is more than two weeks out, watch a few more captures.')
      // Too little history to call a price good or bad — say so rather than guess.
      :'This log has only '+plural(FLOOR_N,'observation')+' across '+plural(FLOOR_CAPS,'capture day')+', which is not enough to say whether this is a good price.';
    const today=bestS.departsToday?' <b>The outbound travels today</b>, so it may already have departed.':'';
    body.innerHTML=cmp+floorTxt+today+' Both legs are from the capture of '+esc(bestS.captured)+'.'+basisNote;
    return;
  }
  head.textContent='Cheapest round trip on any train: weekend of '+best.k+' — about '+money(best.rt)+'.';
  body.innerHTML='This is the rock-bottom fare and often rides a late-evening or early-morning train. Both legs are from the capture of '+esc(best.captured)+'. Switch to <b>Sensible hours</b> above to see the cheapest trip at usable times'+(bestS?' ('+money(bestS.rt)+')':'')+'.';
}

// In a browser: init charts and auto-load the committed CSV (GitHub Pages or any
// http server); skipped under Node so the pure helpers can be require()d by tests.
//
// The fetch failure and the parse failure are reported separately. They used to
// share one handler, so an empty or corrupt CSV threw inside parseCSV and the
// page blamed it on being "opened via file://" — sending the reader to a manual
// import that would have failed the same way.
if(typeof document!=='undefined'){
  initDashboard();
  fetch('data/amtrak_fare_log.csv',{cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status+' '+r.statusText);return r.text();})
    .then(text=>{
      let result;
      try{result=parseCSV(text);}
      catch(err){result={ok:false,error:'The fare log could not be parsed: '+err.message};}
      ingest(result);
    })
    .catch(err=>{
      document.getElementById('loadStatus').innerHTML='Auto-load unavailable ('+esc(err&&err.message||'network error')+'). Click <b>Load fare log</b> and pick <b>data/amtrak_fare_log.csv</b>.';
      document.getElementById('metaline').textContent='Showing seed snapshot — load the CSV to go live.';
      renderQuality(null);
    });
}
if(typeof module!=='undefined'&&module.exports){module.exports={parseCSV,weekendKey,bandFor,seasonData,seasonGaps,shortDate,esc,money};}
