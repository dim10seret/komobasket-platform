import { resolveScorerSession, scorerAuthErrorResponse, scorerAuthSuccess } from "@/services/komocontrol-scorer-auth.service";

export async function GET(request: Request) {
  try {
    return scorerAuthSuccess(await resolveScorerSession(request));
  } catch (error) {
    return scorerAuthErrorResponse(error);
  }
}
