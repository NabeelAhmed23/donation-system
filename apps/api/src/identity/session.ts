export interface AuthenticatedSession {
  userId: string;
  /** Set from the login result; while true, only routes marked @AllowWhilePasswordChangeRequired() run. */
  mustChangePassword: boolean;
}
