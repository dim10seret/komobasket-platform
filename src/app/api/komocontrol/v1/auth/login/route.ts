import { validateLoginInput } from "@/services/komocontrol-scorer-auth-core";
import { loginScorer, scorerAuthErrorResponse, scorerAuthSuccess } from "@/services/komocontrol-scorer-auth.service";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    return scorerAuthSuccess(await loginScorer(validateLoginInput(body)));
  } catch (error) {
    return scorerAuthErrorResponse(error);
  }
}
