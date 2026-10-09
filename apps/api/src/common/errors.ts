export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {}

export class ForbiddenError extends DomainError {}

export class NotFoundError extends DomainError {}

export class ConflictError extends DomainError {}

/** The request must say which version it was based on (If-Match) before it can be applied. */
export class PreconditionRequiredError extends DomainError {}
