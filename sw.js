// ---------------------------------------------------------------------------
// SERVICE WORKER — this is what makes the app work with no signal.
//
// Think of it as a valve sitting between the app and the internet. Every
// request the app makes passes through here first, and this file decides
// whether to answer from the copy stored on the phone or go out to the
// network for it.
//
// It lives in its own file, separate from index.html, because the phone runs
// it even when the app is closed. That is also why it can answer a request
// before the app has finished loading.
// ---------------------------------------------------------------------------


// The name of the storage container on the phone. Change the version number
// whenever the file list below changes — the phone treats a new name as a
// brand new container and throws the old one out.
const CACHE = "lift-register-v8";

// The files the app needs in order to start at all.
const SHELL = [
  "./",
  "./index.html",
  "./jsQR.js",     // the decoder, so scanning works with no signal
  "./manifest.json",
  "./icon-lr-2.png"
];


// ---------------------------------------------------------------------------
// 1. INSTALL — runs once, the first time the phone sees this file.
//    Downloads everything in SHELL and stores it on the phone.
// ---------------------------------------------------------------------------

self.addEventListener("install", event => {
  // waitUntil means "do not call the install finished until this is done."
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // "reload" means go to the server, do not accept a copy the browser is
      // already holding. GitHub tells browsers a file is good for ten minutes,
      // so without this an install can stash a version that is already old.
      cache.addAll(SHELL.map(file => new Request(file, { cache: "reload" })))
    )
  );

  // Normally a new service worker waits until every old tab is closed before
  // taking over. We do not want to wait.
  self.skipWaiting();
});


// ---------------------------------------------------------------------------
// 2. ACTIVATE — runs when a new version takes over.
//    Deletes the older containers so old files cannot be served by mistake.
// ---------------------------------------------------------------------------

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(name => name !== CACHE).map(name => caches.delete(name))
      )
    )
  );

  self.clients.claim();   // take control of pages that are already open
});


// ---------------------------------------------------------------------------
// 3. FETCH — every single request the app makes lands here.
// ---------------------------------------------------------------------------

self.addEventListener("fetch", event => {
  const request = event.request;

  // Only reads. Nothing is being sent to a server yet, but when the scan form
  // exists this line keeps us from trying to cache a submission.
  if (request.method !== "GET") return;

  // A scan opens an address ending in ?id=A4X7. Every machine is a different
  // address, but they are all the SAME page — the id is read by the script
  // once the page is running.
  //
  // So when the phone asks for a page, we hand back index.html and ignore
  // whatever comes after the question mark. Without this line, every machine
  // would be a fresh address the phone has never stored, and the app would
  // need a signal after all. This is the whole trick.
  if (request.mode === "navigate") {
    event.respondWith(serveApp());
    return;
  }

  // Everything else — later this will be the scanner file and the photos.
  event.respondWith(serveFile(request));
});


// Serve the app itself: hand over the stored copy immediately, then quietly
// fetch a fresh one in the background for next time.
//
// The operator never waits on the network, and an update we push lands on his
// phone the next time he opens the app. If he has no signal the background
// fetch simply fails and nothing breaks.
async function serveApp() {
  const cache = await caches.open(CACHE);
  const stored = await cache.match("./index.html");

  // Same reason as above: the background refresh has to actually reach the
  // server, or the app can sit on an old version for ten minutes after a
  // change was pushed and look like updating is broken.
  const fromNetwork = fetch(new Request("./index.html", { cache: "reload" }))
    .then(response => {
      if (response && response.ok) cache.put("./index.html", response.clone());
      return response;
    })
    .catch(() => null);

  // Stored copy if we have one, otherwise wait on the network.
  const response = stored || (await fromNetwork);

  return response || new Response(
    "<p>No stored copy of the app on this phone yet, and no signal to fetch one.</p>",
    { status: 503, headers: { "Content-Type": "text/html" } }
  );
}


// Serve any other file: stored copy if we have it, otherwise fetch it and
// keep a copy for next time.
async function serveFile(request) {
  const cache = await caches.open(CACHE);
  const stored = await cache.match(request);
  if (stored) return stored;

  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response("", { status: 504 });
  }
}
