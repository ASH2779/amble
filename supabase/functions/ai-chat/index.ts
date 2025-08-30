import { serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const openaiKey = Deno.env.get("OPENAI_API_KEY");

if (!supabaseUrl || !supabaseKey || !openaiKey) {
  console.error("Missing env vars:", { supabaseUrl, supabaseKey, openaiKey });
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  try {
    const { message } = await req.json();
    console.log("Incoming message:", message);

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Invalid message" }), { status: 400 });
    }

    const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: message },
        ],
      }),
    });

    const text = await openAIResponse.text();
    console.log("Raw OpenAI response:", text);

    if (!openAIResponse.ok) {
      throw new Error(`OpenAI error: ${openAIResponse.status} - ${text}`);
    }

    const result = JSON.parse(text);
    const reply = result.choices?.[0]?.message?.content || "No reply from AI.";

    return new Response(JSON.stringify({ reply }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
