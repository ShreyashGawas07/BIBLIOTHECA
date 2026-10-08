const C='mybooks-v14';
self.oninstall=e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon.svg','icon-192.png',
 // reader shell, so it opens offline; vendor files are cached on first use
 'reader/','reader/index.html','reader/css/app.css','reader/js/app.js','reader/js/db.js','reader/js/bridge.js','reader/js/settings.js','reader/js/formats.js','reader/js/ui.js',
 'reader/js/reader.js','reader/js/autoscroll.js','reader/js/highlights.js','reader/js/notes.js','reader/js/pdf-reflow.js',
 'reader/fonts/literata.woff2','reader/fonts/literata-italic.woff2','reader/fonts/instrument-serif.woff2','reader/fonts/plex-mono-400.woff2','reader/fonts/plex-mono-500.woff2',
 'reader/vendor/foliate/view.js','reader/vendor/foliate/paginator.js','reader/vendor/foliate/epub.js','reader/vendor/foliate/epubcfi.js','reader/vendor/foliate/overlayer.js','reader/vendor/foliate/progress.js','reader/vendor/foliate/text-walker.js','reader/vendor/foliate/vendor/zip.js'].map(u=>new Request(u,{cache:'reload'})))))};
self.onactivate=e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=C&&x!='state').map(x=>caches.delete(x)))).then(()=>clients.claim()));
self.onfetch=e=>{if(new URL(e.request.url).origin!=location.origin)return;
 // revalidate with the server so an update never mixes old and new files
 const req=e.request.mode=='navigate'?e.request:new Request(e.request,{cache:'no-cache'});
 e.respondWith(fetch(req).then(r=>{if(r.status==200){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c)).catch(()=>{})}return r}).catch(()=>caches.match(e.request)))};
// daily reminder pushed by the GitHub Actions workflow (.github/workflows/reminder.yml)
self.onpush=e=>e.waitUntil(caches.open('state').then(c=>c.match('state.json')).then(r=>r?r.json():{}).catch(()=>({})).then(s=>{
 const d=new Date(),today=new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10),read=s.date==today&&s.pt>0;
 const body=read?`You read ${s.pt} pages today. A few more?`:s.title?`“${s.title}” is ${s.pct}% done. ${s.st?`Keep your ${s.st}-day streak alive.`:'Start a streak today.'}`:'A few pages before bed?';
 return self.registration.showNotification('Time to read',{body,icon:'icon-192.png',badge:'icon-192.png',tag:'daily'})}));
self.onnotificationclick=e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(w=>w[0]?w[0].focus():clients.openWindow('./')))};
