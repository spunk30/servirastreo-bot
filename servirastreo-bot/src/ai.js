import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./knowledge.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// history: [{role:"user"|"assistant", content}]
// returns { reply, escalate }
export async function generateReply(history, userMessage) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userMessage }
  ];

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.4,
    max_tokens: 400
  });

  const raw = resp.choices?.[0]?.message?.content?.trim() || "";
  const escalate = /\[\[ESCALAR\]\]/i.test(raw);
  const reply = raw.replace(/\[\[ESCALAR\]\]/gi, "").trim();
  return { reply, escalate };
}
