// Retire the legacy root worker. The maintained app uses apps/web's generated
// worker; keeping both under the same Pages scope lets an old deployment take
// control of the current client.
self.addEventListener("install", () => self.skipWaiting());

function isLegacyCacheName(key) {
  return key === "daifugo-v1" || key === "yugigoten-v3" || key.startsWith("daifugo-luxe-");
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter(isLegacyCacheName).map((key) => caches.delete(key))),
        ),
      self.registration.unregister(),
    ]),
  );
});
