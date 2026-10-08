// Render routes new traffic to the replacement instance before terminating this
// process. Close the listener while allowing already accepted work to finish.
const installGracefulShutdown = (server, { processLike = process, deadlineMs = 29000, logger = console } = {}) => {
  let stopping = false;
  server.on('request', (req, res) => res.once('finish', () => {
    if (stopping) setImmediate(() => server.closeIdleConnections?.());
  }));
  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    logger.log(JSON.stringify({type:'server_shutdown',signal,state:'draining'}));
    const deadline = setTimeout(() => {
      logger.error(JSON.stringify({type:'server_shutdown',state:'deadline_exceeded'}));
      server.closeAllConnections?.();
      processLike.exit(1);
    }, deadlineMs);
    deadline.unref();
    server.close(error => {
      clearTimeout(deadline);
      logger.log(JSON.stringify({type:'server_shutdown',state:'drained'}));
      processLike.exit(error ? 1 : 0);
    });
  };
  processLike.on('SIGTERM', shutdown);
  processLike.on('SIGINT', shutdown);
  return shutdown;
};
module.exports = { installGracefulShutdown };
