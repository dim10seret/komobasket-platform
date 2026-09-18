export type UserOrganizationMembership = {
  organizationId: string;
  organizationName: string;
  logoUrl: string | null;
  role: "admin" | "viewer";
};

export type OrganizationUserIdentity = {
  user: { id: string; email: string; displayName: string | null };
  memberships: UserOrganizationMembership[];
};
