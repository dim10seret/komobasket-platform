import Link from "next/link";
import { ChevronRight } from "lucide-react";

type TeamBreadcrumbProps = {
  team: string;
};

export default function TeamBreadcrumb({
  team,
}: TeamBreadcrumbProps) {
  return (
    <nav className="flex items-center gap-2 text-sm text-gray-400 mb-8">

      <Link
        href="/"
        className="hover:text-white transition-colors"
      >
        Home
      </Link>

      <ChevronRight size={16} />

      <Link
        href="/teams"
        className="hover:text-white transition-colors"
      >
        Teams
      </Link>

      <ChevronRight size={16} />

      <span className="text-white font-medium">
        {team}
      </span>

    </nav>
  );
}