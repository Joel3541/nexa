import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

/** Wraps an async handler so rejections reach the error middleware. */
export function handler(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Parses input with a Zod schema and converts failures into field-level
 * messages the client can render inline. Nothing unvalidated reaches a service.
 */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'form';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Please check the highlighted fields.', fields);
  }
  return result.data;
}

/**
 * Reads a path parameter as a single string.
 *
 * Express 5 types params as `string | string[]` because a route pattern can
 * repeat a name. Every NEXA route uses each name once, so this narrows and
 * rejects anything unexpected rather than letting an array reach a query.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name as keyof typeof req.params] as string | string[] | undefined;
  if (typeof value === 'string' && value.length > 0) return value;
  throw badRequest(`Missing or invalid "${name}" in the URL.`);
}

export function paginate<T>(rows: T[], page: number, pageSize: number, total: number) {
  return {
    data: rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}
