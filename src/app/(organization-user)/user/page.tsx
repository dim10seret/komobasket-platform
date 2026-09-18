import { cookies } from "next/headers";
import UserPortal from "@/components/user/UserPortal";
import { ORGANIZATION_USER_SESSION_COOKIE_NAME, OrganizationUserAuthError } from "@/services/organization-user-auth-core";
import { organizationUserLoginService, UserLoginError } from "@/services/organization-user-login.service";
import type { OrganizationUserIdentity } from "@/types/organization-user";

export const dynamic = "force-dynamic";

export default async function UserPage() {
  const token = (await cookies()).get(ORGANIZATION_USER_SESSION_COOKIE_NAME)?.value;
  let identity: OrganizationUserIdentity | null = null;
  if (token) {
    try {
      identity = await (await organizationUserLoginService()).resolve(token);
    } catch (error) {
      if (!(error instanceof OrganizationUserAuthError || error instanceof UserLoginError)) throw error;
    }
  }
  return <UserPortal initialIdentity={identity} />;
}
