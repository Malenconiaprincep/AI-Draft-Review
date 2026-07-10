import { reviewDraft, resolveProviderConfigFromEnv } from "@tutti/ai-assistant-service";

export async function POST(request: Request) {
  const input: unknown = await request.json();
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
