const C='mybooks-v3';
self.oninstall=e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon.svg'])))};
self.onactivate=e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=C).map(x=>caches.delete(x)))));
self.onfetch=e=>{if(new URL(e.request.url).origin!=location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))};
self.onnotificationclick=e=>{e.notification.close();e.waitUntil(clients.openWindow('./'))};
