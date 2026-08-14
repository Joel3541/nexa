/**
 * Application errors.
 *
 * Every failure that reaches a client is an AppError with a stable code and a
 * message written for a business owner, not a developer. Stack traces and
 * database detail stay server-side.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);

export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = "You don't have permission to do that.") =>
  new AppError(403, 'forbidden', message);

export const notFound = (what = 'That record') => new AppError(404, 'not_found', `${what} could not be found.`);

export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(409, 'conflict', message, fields);

export const tooManyRequests = (message = 'Too many attempts. Please wait a moment and try again.') =>
  new AppError(429, 'rate_limited', message);

export const serverError = (message = 'Something went wrong on our side. Please try again.') =>
  new AppError(500, 'server_error', message);
