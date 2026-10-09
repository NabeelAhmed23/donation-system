export type AuditValue = string | number | boolean | null;

/**
 * One append-only audit_log row. The organisation is not part of the entry: it is the tenant context of
 * the transaction that writes it, so an entry can never be filed under another organisation.
 */
export interface AuditEntry {
  actorUserId: string;
  action: string;
  entity: string;
  entityId: string;
  /** Old values of exactly the fields that changed. */
  before: Record<string, AuditValue>;
  /** New values of the same fields. */
  after: Record<string, AuditValue>;
  at: Date;
}
