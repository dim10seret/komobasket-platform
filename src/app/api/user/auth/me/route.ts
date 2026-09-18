import { handleUserAuth } from "@/lib/organization-user-http";

export function GET(request: Request) {
  return handleUserAuth(request, "me");
}
