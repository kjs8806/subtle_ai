export const requireQuery = (request, fields = []) => {
  for (const field of fields) {
    if (typeof request.query?.[field] !== 'string' || request.query[field].length === 0 || request.query[field].length > 512) {
      const error = new Error(`Invalid query parameter: ${field}`)
      error.statusCode = 400
      error.code = 'invalid_request'
      throw error
    }
  }
}
