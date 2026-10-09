export interface RoleAssignmentStore {
  /** True when `roleRef` is the id or key of a platform role (e.g. super_admin). */
  isPlatformRole(roleRef: string): Promise<boolean>;
  findMembership(orgId: string, membershipId: string): Promise<{ id: string } | null>;
  findRole(orgId: string, roleId: string): Promise<{ id: string } | null>;
  hasRole(orgId: string, membershipId: string, roleId: string): Promise<boolean>;
  assignRole(orgId: string, membershipId: string, roleId: string): Promise<void>;
}
