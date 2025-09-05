// supabase/functions/ai-chat/index.ts
import { serve } from "https://deno.land/std/http/server.ts";

type Message = { role: "system" | "user" | "assistant"; content: string };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*", // allow any headers
};

serve(async (req) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response("Missing OPENAI_API_KEY", {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response("Use application/json", {
        status: 415,
        headers: CORS_HEADERS,
      });
    }

    const body = await req.json();
    const messages: Message[] = body?.messages;
    const stream: boolean = !!body?.stream;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("Invalid request: missing messages[]", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Call OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        stream,
      }),
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text();
      return new Response(`OpenAI error: ${txt}`, {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    // Non-streaming
    if (!stream) {
      const data = await openaiRes.json();
      const content =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.delta?.content ??
        "";
      return new Response(JSON.stringify({ content }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Streaming
    const encoder = new TextEncoder();
    const reader = openaiRes.body?.getReader();
    if (!reader) {
      return new Response("No body to stream", {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    const streamOut = new ReadableStream({
      async start(controller) {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += new TextDecoder().decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";

            for (const chunk of parts) {
              const line = chunk.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;

              try {
                const json = JSON.parse(payload);
                const delta = json?.choices?.[0]?.delta?.content ?? "";
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // ignore parse errors
              }
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(streamOut, {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return new Response(`Server error: ${err?.message || err}`, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

