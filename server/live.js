// Live channels: server-sent events, one channel per key.
//
// A page subscribes with <div ko-connect="…/live?from=N">. What it receives is
// markup with ko-into, delivered by Koda like the out-of-band part of a
// response (reference: "A channel the server can speak on").

export function createLive() {
  const channels = new Map();   // key -> Set<res>

  const write = (res, message) => {
    res.write(String(message).split('\n').map(line => `data: ${line}`).join('\n') + '\n\n');
  };

  return {
    /**
     * Start an event stream on `res`, send `initial` messages, then keep it
     * subscribed to `key` - or to each of several keys, so one page has one
     * channel. `onClose` runs when the page goes away.
     */
    open(key, req, res, initial = [], { onClose = () => {} } = {}) {
      const keys = [key].flat();
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': open\n\n');
      for (const message of initial) write(res, message);

      for (const one of keys) {
        if (!channels.has(one)) channels.set(one, new Set());
        channels.get(one).add(res);
      }
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

      req.on('close', () => {
        clearInterval(keepAlive);
        for (const one of keys) {
          channels.get(one)?.delete(res);
          if (channels.get(one)?.size === 0) channels.delete(one);
        }
        onClose();
      });
    },

    publish(key, message) {
      for (const res of channels.get(key) ?? []) write(res, message);
    },

    /** How many pages are subscribed to `key`. */
    listening: key => channels.get(key)?.size ?? 0,

    closeAll() {
      for (const subscribers of channels.values()) for (const res of subscribers) res.end();
      channels.clear();
    },
  };
}
