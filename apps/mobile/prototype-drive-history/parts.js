const ic=(n,s=22,c='currentColor',w=2)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" style="flex:none">${ICONS[n]}</svg>`;
const status=`<div class="status"><span>18:20</span><span>▼◢ ▮</span></div>`;
const phone=(inner,bg='')=>`<div class="phone" style="${bg}">${inner}<div class="gbar"></div></div>`;
const frame=(cap,sub,html)=>`<div class="col"><div class="cap">${cap}<small>${sub}</small></div>${html}</div>`;
const score=(n)=>n==null?`<div class="score none">—</div>`:`<div class="score ${n<80?'mid':''}">${n}</div>`;
const av=(t,s=36,c='#E6005C')=>`<div style="width:${s}px;height:${s}px;border-radius:${s/2}px;background:${c};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:500;font-size:${s*.4}px;flex:none">${t}</div>`;

const ROUTE="M70 800 C110 740 120 700 150 650 S210 560 205 500 S240 400 280 360 S320 260 330 210 S350 150 360 120";
const EV={S:['#C62828','gauge'],B:['#6A1B9A','chevrons-down'],A:['#EF6C00','chevrons-up'],P:['#1565C0','smartphone']};
const EVENTS=[[205,500,'S'],[160,630,'A'],[280,360,'B'],[338,190,'P']];
const map=({route=true,events=true,dim=false,unchecked=false}={})=>`<div class="mapw" ${dim?'style="filter:saturate(.6) brightness(.97)"':''}><svg viewBox="0 0 412 915">
${route?`<path d="${ROUTE}" stroke="#fff" stroke-width="11" fill="none" stroke-linecap="round"/><path d="${ROUTE}" stroke="var(--drive)" stroke-width="6" fill="none" stroke-linecap="round"/>`:''}
${route&&unchecked?`<path d="M150 650 S210 560 205 500" stroke="#fff" stroke-width="6" fill="none" stroke-dasharray="2 9" stroke-linecap="round"/>`:''}
${route&&events?EVENTS.map(([x,y,k])=>`<circle cx="${x}" cy="${y}" r="15" fill="${EV[k][0]}" stroke="#fff" stroke-width="3"/>${ic(EV[k][1],16,'#fff',2.4).replace('<svg',`<svg x="${x-8}" y="${y-8}"`)}`).join(''):''}
${route?`<circle cx="70" cy="800" r="9" fill="#fff" stroke="var(--drive)" stroke-width="4"/><circle cx="360" cy="120" r="9" fill="var(--drive)" stroke="#fff" stroke-width="3"/>`:''}
</svg></div>`;

const topbar=(title,right=`<div class="gchip"><i></i>Family${ic('chevron-down',18)}</div>`)=>`<div class="topbar"><div class="bk">${ic('chevron-left',22)}</div><b>${title}</b>${right}</div>`;

const H=(h)=>18+h/24*326;
const scrubber=({segs,head=17.8,style='band'})=>{
  const parts=segs.map(([a,b,k])=>{
    const x=H(a),w=Math.max(H(b)-H(a),3);
    if(k==='stop')return `<rect x="${x}" y="16" width="${w}" height="10" rx="3" fill="#F8A5C2"/>`;
    if(k==='move')return `<rect x="${x}" y="13" width="${w}" height="16" rx="3" fill="#E6005C"/>`;
    if(k==='drive'&&style==='band')return `<rect x="${x}" y="10" width="${w}" height="22" rx="4" fill="var(--drive)"/>`;
    if(k==='drive'&&style==='tick')return `<rect x="${x}" y="13" width="${w}" height="16" rx="3" fill="#E6005C"/><g transform="translate(${x+w/2-9},-8)">${ic('car',18,'var(--drive)').replace('<svg','<svg x="0" y="0"')}</g>`;
    if(k==='pass'&&style==='band')return `<rect x="${x}" y="10" width="${w}" height="22" rx="4" fill="none" stroke="var(--drive)" stroke-width="2.5" stroke-dasharray="3 2"/>`;
    if(k==='pass')return `<rect x="${x}" y="13" width="${w}" height="16" rx="3" fill="#E6005C"/>`;
    return '';
  }).join('');
  return `<svg width="352" height="56" viewBox="0 0 352 56" style="display:block;margin:6px 0 0">${parts}
  <line x1="${H(head)}" x2="${H(head)}" y1="4" y2="38" stroke="var(--on)" stroke-width="3"/><circle cx="${H(head)}" cy="6" r="8" fill="var(--on)"/>
  <g font-size="12" fill="var(--onv)" font-family="Roboto">${[0,6,12,18,24].map(h=>`<text x="${H(h)}" y="52" text-anchor="middle">${String(h).padStart(2,'0')}</text>`).join('')}</g></svg>`;
};
const DAY=[[0,7.87,'stop'],[7.87,8.35,'drive'],[8.35,8.48,'stop'],[8.48,8.97,'drive'],[8.97,12.67,'stop'],[12.67,12.92,'pass'],[12.92,13.1,'stop'],[13.1,13.2,'move'],[13.2,17.5,'stop'],[17.5,18.2,'drive'],[18.2,18.35,'stop']];
const controls=`<div class="row" style="justify-content:space-between;margin-top:12px">${['skip-back','rewind'].map(n=>`<div style="width:48px;height:48px;border-radius:24px;background:var(--scc);display:flex;align-items:center;justify-content:center">${ic(n,20)}</div>`).join('')}<div style="width:60px;height:60px;border-radius:30px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center">${ic('play',26)}</div>${['fast-forward','skip-forward'].map(n=>`<div style="width:48px;height:48px;border-radius:24px;background:var(--scc);display:flex;align-items:center;justify-content:center">${ic(n,20)}</div>`).join('')}</div>`;

const ev=(k,t,s)=>`<div class="ev"><div class="d" style="background:${EV[k][0]}">${ic(EV[k][1],17,'#fff',2.4)}</div><div><b style="font-weight:500">${t}</b><small>${s}</small></div></div>`;
const EVLIST=[
  ev('A','Rapid acceleration · 12 → 38 mph in 4 s','17:41 · Barnet Lane'),
  ev('S','Speeding · 41 mph for 22 s','17:44 · posted limit 30 mph · Mays Lane'),
  ev('B','Hard braking · 31 → 4 mph','17:52 · A1000 Great North Road'),
  ev('P','Phone use · unlocked 1 min','18:03 · while moving at 28 mph'),
].join('');
const UNCHECKED=`<div class="note">${ic('triangle-alert',18,'var(--warn)')}<div><b>Speeding not checked for 3.4 mi</b> (dotted on the map). Speed limits on those roads are unknown.</div></div>`;
