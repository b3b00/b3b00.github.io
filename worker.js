const pwaCache = "pwa-cache";

console.log("starting worker");

const assets = [
  "/",
  "/index.html",
  "/css/style.css",
  "/dist/bundle.js",
  "/images/icons/icon-72x72.png",
  "/images/icons/icon-96x96.jpg",
  "/images/icons/icon-128x128.jpg",
  "/images/icons/icon-144x144.jpg",
  "/images/icons/icon-152x152.jpg",
  "/images/icons/icon-192x192.jpg",
  "/images/icons/icon-384x384.jpg",
  "/images/icons/icon-512x512.jpg"
];

self.addEventListener("activate", function(event) {
  console.log("Claiming control");
  return self.clients.claim();
});



console.log("register install event");
self.addEventListener("install", installEvent => {
  try {
    console.log("install event called", assets);
    installEvent.waitUntil(
      caches.open(pwaCache).then(cache => {
        console.log("caching ", assets);
        cache.addAll(assets);
      })
    );
    console.log("worker is installed now.");
  } catch (e) {
    console.log("error", e);
  }
});

self.addEventListener("fetch", event => {
  console.log("Fetching:", event.request.url);
});

self.addEventListener("fetch", fetchEvent => {
  console.log("worker fetching", fetchEvent);
  try {
    fetchEvent.respondWith(
      caches.match(fetchEvent.request).then(res => {
        try {
          return res || fetch(fetchEvent.request);
        } catch (e) {
          console.log("feth", e);
        }
      })
    );
  } catch (e) {
    console.log("error fetch event : ", event, e);
  }
});

self.addEventListener('push', event => {
  
  // navigator.serviceWorker.getRegistration()
  // .then(reg => reg.showNotification("I've received a notification", []));
  var notificationTitle = 'Hello';
  var notificationOptions = {
    body: 'Thanks for sending this push msg.',
    icon: './images/logo-192x192.png',
    badge: './images/badge-72x72.png',
    tag: 'simple-push-demo-notification',
    data: {
      url: 'https://developers.google.com/web/fundamentals/getting-started/push-notifications/'
    }
  };

  if (event.data) {
    var dataText = event.data.text();
    notificationTitle = 'Received Payload';
    notificationOptions.body = 'Push data: \'' + dataText + '\'';
  }

  event.waitUntil(Promise.all([self.registration.showNotification(notificationTitle, notificationOptions)]));
;
})

;
