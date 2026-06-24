/**
 * Reusable Groq API helpers.
 *
 * Issue #15/#16/#18: thin wrappers over the Groq OpenAI-compatible endpoints
 * for (1) Whisper audio transcription and (2) chat completions. Both read the
 * `GROQ_API_KEY` env var and throw on non-2xx responses so callers can retry.
 */

import { readFile } from 'node:fs/promises';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

/** Default Whisper model id used by `groqTranscribe`. */
export const WHISPER_MODEL = 'whisper-large-v3';

/** Default chat model id used by `groqChat` when none is supplied. */
export const DEFAULT_CHAT_MODEL = 'llama-3.3-70b';

/** OpenAI-style chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function getApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error('GROQ_API_KEY is not set — cannot call Groq API.');
  }
  return key;
}

/**
 * Transcribe an audio file via Groq's Whisper endpoint.
 *
 * POSTs the file as multipart/form-data to
 * `/audio/transcriptions` with `model=whisper-large-v3`.
 *
 * @returns The transcribed text.
 * @throws  on HTTP error or missing API key.
 */
export async function groqTranscribe(
  audioPath: string,
  model: string = WHISPER_MODEL,
): Promise<string> {
  const key = getApiKey();
  const buffer = await readFile(audioPath);

  // Node 20+ provides global FormData, Blob, and File.
  const blob = new Blob([buffer]);
  const file = new File([blob], 'audio.wav', { type: 'audio/wav' });

  const form = new FormData();
  form.append('file', file);
  form.append('model', model);
  form.append('response_format', 'text');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Groq transcription failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }

  // response_format=text returns raw transcript text.
  const text = await res.text();
  return text.trim();
}

/**
 * Send a chat-completions request to Groq and return the assistant message
 * content.
 *
 * @param messages  OpenAI-style chat messages.
 * @param model     Groq model id (defaults to `llama-3.3-70b`).
 * @returns         The assistant's reply text.
 * @throws          on HTTP error or missing API key.
 */
export async function groqChat(
  messages: ChatMessage[],
  model: string = DEFAULT_CHAT_MODEL,
): Promise<string> {
  const key = getApiKey();

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Groq chat failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq chat returned an empty response.');
  }
  return content.trim();
}
