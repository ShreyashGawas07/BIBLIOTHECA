const C='mybooks-v1',F=['./','index.html','manifest.json','icon.svg'];
self.oninstall=e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)));
self.onfetch=e=>{if(new URL(e.request.url).origin==location.origin)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))};
self.onnotificationclick=e=>{e.notification.close();e.waitUntil(clients.openWindow('./'))};
