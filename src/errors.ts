/** Item does not exist (unknown ratingKey or TVDB 404). Mapped to HTTP 404. */
export class NotFoundError extends Error {}

/** Malformed request from Plex. Mapped to HTTP 400. */
export class BadRequestError extends Error {}
