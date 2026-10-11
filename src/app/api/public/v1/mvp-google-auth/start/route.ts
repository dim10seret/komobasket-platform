import { handleMvpGoogleAuth } from "@/services/mvp-google-auth.service";

export function GET(request: Request) { return handleMvpGoogleAuth(request, "start"); }
