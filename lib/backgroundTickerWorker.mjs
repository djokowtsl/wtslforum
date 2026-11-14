// A dedicated worker supplies ticks while the host page is in the background.
let timer = null;
self.onmessage = (event) => {
  if (timer !== null) clearInterval(timer);
  timer = null;
  const interval = Number(event.data);
  if (Number.isFinite(interval) && interval > 0) timer = setInterval(() => self.postMessage(0), interval);
};
