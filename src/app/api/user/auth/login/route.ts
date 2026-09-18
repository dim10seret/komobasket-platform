import { handleUserAuth } from "@/lib/organization-user-http";

export function POST(request: Request) {
  return handleUserAuth(request, "login");
}
