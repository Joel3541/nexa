import { randomUUID } from 'node:crypto';
import { env } from '@nexa/config';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const requestId: RequestHandler = (req, res, next) => {
  const id = req.header('x-request-id') ?? randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}.`, requestId: req.requestId },
  });
};

/**
 * Terminal error handler.
 *
 * Known AppErrors are returned verbatim — they carry messages written for
 * users. Anything else is logged with full detail and reduced to a generic
 * message, so internal structure never leaks to a client.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error(error.message, { requestId: req.requestId, path: req.path, code: error.code });
    }
    res.status(error.status).json({
      error: { code: error.code, message: error.message, fields: error.fields, requestId: req.requestId },
    });
    return;
  }

  const detail = error instanceof Error ? { message: error.message, stack: error.stack } : { value: String(error) };
  logger.error('unhandled error', { requestId: req.requestId, method: req.method, path: req.path, ...detail });

  res.status(500).json({
    error: {
      code: 'server_error',
      message: 'Something went wrong on our side. Please try again.',
      requestId: req.requestId,
      ...(env.NODE_ENV === 'development' && error instanceof Error ? { debug: error.message } : {}),
    },
  });
};
