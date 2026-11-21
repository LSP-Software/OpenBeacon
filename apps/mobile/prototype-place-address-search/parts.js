const I={
search:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>',
x:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1c1530" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
xs:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a8399" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
loc:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1c1530" stroke-width="2" stroke-linecap="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>',
pinI:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5b3fb3" stroke-width="2" stroke-linecap="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
back:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1c1530" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>',
};
const MAP=`<svg class="map" viewBox="0 0 390 844" preserveAspectRatio="none"><rect width="390" height="844" fill="#ebe8e3"/>
<g fill="#dcd8d2">${Array.from({length:60},(_, i)=>`<rect x="${(i*67)%380}" y="${(i*131)%830}" width="${30+(i*13)%40}" height="${24+(i*7)%40}" rx="2"/>`).join("")}</g>
<rect x="250" y="560" width="60" height="140" fill="#cfe6cf" transform="rotate(-12 280 630)"/>
<g stroke="#fff" stroke-width="9" fill="none"><path d="M-10 120 L400 60"/><path d="M200 -10 L215 860"/><path d="M-10 420 L400 500"/><path d="M40 860 L330 -10"/><path d="M-10 700 L400 640"/><path d="M90 -10 L-10 300"/></g>
<g font-size="10" fill="#8f8a84" font-family="sans-serif"><text x="222" y="300">High Street</text><text x="20" y="410">Wood Street</text></g></svg>`;
const pin=(x,y)=>`<svg class="pin" style="left:${x-17}px;top:${y-42}px" viewBox="0 0 34 42"><path d="M17 41C7 31 2 24 2 16a15 15 0 0 1 30 0c0 8-5 15-15 25z" fill="#fff" stroke="#E6005C" stroke-width="3"/><circle cx="17" cy="16" r="5.5" fill="#E6005C"/></svg>`;
const circle=(x,y,d)=>`<div class="circle" style="left:${x-d/2}px;top:${y-d/2}px;width:${d}px;height:${d}px"></div>`;
const base=(inner)=>`<div class="phone">${MAP}<div class="status">12:00</div>${inner}</div>`;
const topBar=(title)=>`<div class="fab" style="left:16px;top:48px">${I.x}</div><div class="pill" style="left:74px;top:48px">${title}</div>`;
const locBtn=(top)=>`<div class="fab" style="right:16px;top:${top}px">${I.loc}</div>`;
const sizeBlock=`<div class="size">Size<span>Small · 100 m</span></div><div class="slider"></div>`;
const results=`
<div class="res"><div class="ic">${I.pinI}</div><div><b>64–66 High St<span class="tag">Near the map</span></b><i>Chipping Barnet, Barnet EN5 5SJ</i></div></div>
<div class="res"><div class="ic">${I.pinI}</div><div><b>High St<span class="tag">Further away</span></b><i>Tyldesley, Manchester</i></div></div>`;
const frame=(cap,sub,html)=>`<div class="col"><div class="cap">${cap}<small>${sub}</small></div>${base(html)}</div>`;
