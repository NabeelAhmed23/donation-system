import type { ExecutionContext } from '@nestjs/common';
import type { HttpSession, SessionRequest } from '../../src/identity/session.js';

export type FakeSession = HttpSession & { readonly id: number; destroyed: boolean };

/** Stands in for @fastify/session: regenerate() replaces `session` with a fresh one under a new id. */
export class FakeSessionRequest implements SessionRequest {
  session: FakeSession;
  private issued = 0;

  constructor() {
    this.session = this.newSession();
  }

  private newSession(): FakeSession {
    const session: FakeSession = {
      id: ++this.issued,
      destroyed: false,
      regenerate: async () => {
        this.session = this.newSession();
      },
      destroy: async () => {
        session.destroyed = true;
      },
    };
    return session;
  }
}

export type RouteHandler = (...args: never[]) => unknown;
export type ControllerClass = new (...args: never[]) => unknown;

export function executionContextFor(
  request: object,
  handler: RouteHandler,
  controller: ControllerClass = class {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}
