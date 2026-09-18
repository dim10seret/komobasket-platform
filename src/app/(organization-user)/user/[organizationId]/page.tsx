import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import UserPortal from "@/components/user/UserPortal";
import { ORGANIZATION_USER_SESSION_COOKIE_NAME, OrganizationUserAuthError } from "@/services/organization-user-auth-core";
import { organizationUserLoginService, UserLoginError } from "@/services/organization-user-login.service";
import type { OrganizationUserIdentity } from "@/types/organization-user";

export const dynamic = "force-dynamic";

export default async function OrganizationEntry({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const token = (await cookies()).get(ORGANIZATION_USER_SESSION_COOKIE_NAME)?.value;
  if (!token) redirect("/user");
  let identity: OrganizationUserIdentity;
  try {
    identity = (await (await organizationUserLoginService()).requireOrganization(token, organizationId)).identity;
  } catch (error) {
    if (error instanceof OrganizationUserAuthError && error.code === "SESSION_INVALID") redirect("/user");
    if (error instanceof UserLoginError && error.status === 403) notFound();
    throw error;
  }
  return <UserPortal initialIdentity={identity} organizationId={organizationId} />;
}
