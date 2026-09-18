import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const requestHeaders = new Headers(await headers());
  const authorization = await requireAdmin(
    new Request("https://komobasket.gr/admin", { headers: requestHeaders }),
  );
  if (authorization.response) notFound();

  return children;
}
