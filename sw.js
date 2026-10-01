const C='mybooks-v8';
self.oninstall=e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon.svg','icon-192.png'])))};
self.onactivate=e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=C&&x!='state').map(x=>caches.delete(x)))).then(()=>clients.claim()));
self.onfetch=e=>{if(new URL(e.request.url).origin!=location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))};
// daily reminder pushed by the GitHub Actions workflow (.github/workflows/reminder.yml)
self.onpush=e=>e.waitUntil(caches.open('state').then(c=>c.match('state.json')).then(r=>r?r.json():{}).catch(()=>({})).then(s=>{
 const d=new Date(),today=new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10),read=s.date==today&&s.pt>0;
 const body=read?`You read ${s.pt} pages today. A few more?`:s.title?`“${s.title}” is ${s.pct}% done. ${s.st?`Keep your ${s.st}-day streak alive.`:'Start a streak today.'}`:'A few pages before bed?';
 return self.registration.showNotification('Time to read',{body,icon:'icon-192.png',badge:'icon-192.png',tag:'daily'})}));
self.onnotificationclick=e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(w=>w[0]?w[0].focus():clients.openWindow('./')))};
