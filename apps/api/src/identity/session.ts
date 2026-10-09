export interface AuthenticatedSession {
  userId: string;
  /** Set from the login result; until it is exactly false, only routes marked @AllowWhilePasswordChangeRequired() run. */
  mustChangePassword: boolean;
}

/** The parts of the server-side session (e.g. @fastify/session) the identity module relies on. */
export interface HttpSession extends Partial<AuthenticatedSession> {
  /** Present while the session is impersonating another user (written by the impersonation story, US-48). */
  impersonationSessionId?: string;
  /** Replaces the session with a fresh one under a new ID; afterwards `request.session` is the new session. */
  regenerate(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SessionRequest {
  session: HttpSession;
}

/** Rotates the session ID before writing the identity into it, so an earlier session ID is never reused. */
export async function establishSession(request: SessionRequest, data: AuthenticatedSession): Promise<void> {
  await request.session.regenerate();
  request.session.userId = data.userId;
  request.session.mustChangePassword = data.mustChangePassword;
}
