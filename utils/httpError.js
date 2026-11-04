// An expected failure with a response for the client. Throwing one inside
// withTransaction rolls back, and the central error handler sends the response.
export class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
