
console.log("starting worker");


self.addEventListener("install", installEvent => {
  console.log("worker is installed now.");
})



self.addEventListener("fetch", fetchEvent => {
    fetchEvent.respondWith(
      caches.match(fetchEvent.request).then(res => {
        return res || fetch(fetchEvent.request)
      })
    );
  });

  console.log("all callbacks registered");