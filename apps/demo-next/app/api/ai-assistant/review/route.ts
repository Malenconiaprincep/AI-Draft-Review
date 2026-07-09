import { reviewDraft, resolveProviderConfigFromEnv } from "@tutti/ai-assistant-service";
import type { DraftReviewInput } from "@tutti/draft-doc";

export async function POST(request: Request) {
  const input = (await request.json()) as DraftReviewInput;
  const providerConfig = resolveProviderConfigFromEnv(process.env);

  try {
    const proposal = await reviewDraft(input, {
      providerConfig
    });
    return Response.json(proposal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI review failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
