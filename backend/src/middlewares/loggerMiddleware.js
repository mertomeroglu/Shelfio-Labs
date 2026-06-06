import { randomUUID } from 'crypto';

export const loggerMiddleware = (req, res, next) => {
  const startedAt = Date.now();
  const requestId = req.headers['x-request-id'] || randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - startedAt;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms requestId=${requestId}`);
  });

  next();
};
