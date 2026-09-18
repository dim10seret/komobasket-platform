import type { ReactNode } from "react";
import HostedOrganizationHeader from "@/components/hosted/HostedOrganizationHeader";
import HostedSupportersFooter from "@/components/hosted/HostedSupportersFooter";
import type { HostedPublicOrganization } from "@/services/hosted-public-organization.service";

export default function HostedOrganizationPublicShell({
  organization,
  children,
}: {
  organization: HostedPublicOrganization;
  children: ReactNode;
}) {
  return <div className="flex min-h-screen flex-col bg-stone-50 text-zinc-950">
    <HostedOrganizationHeader organization={organization} />
    <div className="flex-1">{children}</div>
    <HostedSupportersFooter organizationId={organization.organizationId} />
  </div>;
}
