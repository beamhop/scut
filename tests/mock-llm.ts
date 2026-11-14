// A tiny OpenAI-compatible chat-completions server for tests.
// Turn 1: calls the first tool whose name contains "screenshot". Turn 2 (after the tool result): replies with a summary.
export function startMockLlm(port = 0) {
  const requests: any[] = [];
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "mock-vision" }] });
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
      const body = (await req.json()) as any;
      requests.push(body);
      const msgs: any[] = body.messages ?? [];
      const last = msgs.at(-1);
      const tools: any[] = body.tools ?? [];
      const shotTool = tools.find((t) => /screenshot/.test(t.function?.name ?? ""));
      const sawImage = JSON.stringify(msgs).includes("image_url") || JSON.stringify(msgs).includes("data:image");
      const message =
        msgs.some((m) => m.role === "tool") || !shotTool
          ? { role: "assistant", content: `MOCK_DONE tools=${tools.length} image=${sawImage}` }
          : {
              role: "assistant",
              content: null,
              tool_calls: [{ id: `call_${requests.length}`, type: "function", function: { name: shotTool.function.name, arguments: "{}" } }],
            };
      const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
      if (!body.stream) {
        return Response.json({ id: "x", object: "chat.completion", model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage });
      }
      const chunks: any[] = [];
      const base = { id: "x", object: "chat.completion.chunk", model: body.model };
      if (message.tool_calls) {
        chunks.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: message.tool_calls.map((t: any, i: number) => ({ index: i, ...t })) }, finish_reason: null }] });
        chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage });
      } else {
        chunks.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: message.content }, finish_reason: null }] });
        chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
      }
      const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { server, requests, port: server.port };
}
