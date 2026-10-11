import { handleMvpGoogleAuth } from "@/services/mvp-google-auth.service";

export function POST(request: Request) { return handleMvpGoogleAuth(request, "logout"); }
