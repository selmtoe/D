// Retire the legacy root worker. The maintained app uses apps/web's generated
// worker; keeping both under the same Pages scope lets an old deployment take
// control of the current client.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("daifugo-luxe-")).map((key) => caches.delete(key))),
        ),
      self.registration.unregister(),
    ]),
  );
});
