export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details)
export const notFound = (message = 'Not found') => new HttpError(404, message)
export const conflict = (message, details) => new HttpError(409, message, details)

// Validates input with a zod schema; turns failures into a 400 with field-level messages.
export function parse(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) {
    const fields = Object.fromEntries(result.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
    throw badRequest('Invalid input', { fields })
  }
  return result.data
}
