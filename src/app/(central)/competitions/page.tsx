import PublicCompetitionsView, { type PublicCompetitionsViewProps } from "@/components/competition/PublicCompetitionsView";
import Header from "@/components/layout/Header";
import { PUBLIC_KOMOBASKET_ORGANIZATION_ID } from "@/services/public-competition.service";

export default function CompetitionsPage({ searchParams }: Pick<PublicCompetitionsViewProps, "searchParams">) {
  return <><Header /><PublicCompetitionsView organizationId={PUBLIC_KOMOBASKET_ORGANIZATION_ID} basePath="/competitions" searchParams={searchParams} /></>;
}