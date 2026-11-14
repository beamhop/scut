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
      const userText = JSON.stringify(msgs.filter((m) => m.role === "user").at(-1)?.content ?? "");
      const rememberTool = tools.find((t) => /__remember$/.test(t.function?.name ?? ""));
      const fact = userText.match(/REMEMBER: ([^"\\]+)/)?.[1];
      // Generic: "CALL <tool-suffix> <json>" makes the model call that tool with those arguments.
      const generic = userText.match(/CALL (\w+) (\{.*?\})(?:\\n|")/);
      const genericTool = generic && tools.find((t) => (t.function?.name ?? "").endsWith(`__${generic[1]}`));
      if (((fact && rememberTool) || genericTool) && !msgs.some((m) => m.role === "tool")) {
        requests.push(body);
        const fn = genericTool
          ? { name: genericTool.function.name, arguments: JSON.parse(`"${generic![2]}"`.replace(/^"|"$/g, "").replace(/\\"/g, '"')) }
          : { name: rememberTool.function.name, arguments: { text: fact } };
        const call = { id: `call_r${requests.length}`, type: "function", function: { name: fn.name, arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments) } };
        const base = { id: "x", object: "chat.completion.chunk", model: body.model };
        const sse = [
          { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, ...call }] }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      }
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
