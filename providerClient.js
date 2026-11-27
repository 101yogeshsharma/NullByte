const { GoogleGenAI } = require('@google/genai');
const {
  PROVIDERS,
  OPENROUTER_FALLBACK_MODELS,
  curateModels,
  curateOpenRouterModels,
  curateOllamaModels,
  getFallbackModels,
  formatProviderError
} = require('./modelCatalog');

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function normalizeOllamaUrl(url) {
  const cleaned = (url || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  return cleaned || DEFAULT_OLLAMA_URL;
}

/**
 * Fetches curated models for the configured provider.
 */
async function fetchProviderModels({ provider, apiKey, openrouterApiKey, ollamaUrl, rejectedModels = new Set() }) {
  if (provider === PROVIDERS.OPENROUTER) {
    try {
      const headers = {};
      if (openrouterApiKey && openrouterApiKey.trim()) {
        headers.Authorization = `Bearer ${openrouterApiKey.trim()}`;
      }
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return curateOpenRouterModels(json.data || []);
    } catch (err) {
      return OPENROUTER_FALLBACK_MODELS.map(m => ({ ...m }));
    }
  }

  if (provider === PROVIDERS.OLLAMA) {
    try {
      const base = normalizeOllamaUrl(ollamaUrl);
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return curateOllamaModels(json.models || []);
    } catch (err) {
      return [];
    }
  }

  // Default: Gemini
  if (!apiKey || !apiKey.trim()) {
    return getFallbackModels(rejectedModels);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const rawModels = [];
    for await (const m of pager) {
      rawModels.push(m);
    }
    return curateModels(rawModels, rejectedModels);
  } catch (err) {
    return getFallbackModels(rejectedModels);
  }
}

/**
 * Validates credentials/connectivity and probes generation capability where applicable.
 */
async function testProviderConnection({ provider, apiKey, openrouterApiKey, ollamaUrl, model }) {
  const activeProvider = provider || PROVIDERS.GEMINI;

  if (activeProvider === PROVIDERS.OPENROUTER) {
    const key = (openrouterApiKey || '').trim();
    if (!key) {
      return { ok: false, status: 'missing_key', message: 'Please enter an OpenRouter API key first.' };
    }
    try {
      const keyRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (!keyRes.ok) {
        return { ok: false, status: 'invalid_key', message: `OpenRouter rejected this key (HTTP ${keyRes.status}).` };
      }
      const models = await fetchProviderModels({ provider: activeProvider, openrouterApiKey: key });
      const freeCount = models.filter(m => m.tier === 'free').length;
      return {
        ok: true,
        status: 'ok',
        models,
        message: `OpenRouter key is valid! Found ${models.length} vision models (${freeCount} free).`
      };
    } catch (err) {
      return { ok: false, status: 'network_error', message: `Could not reach OpenRouter: ${err.message}` };
    }
  }

  if (activeProvider === PROVIDERS.OLLAMA) {
    const base = normalizeOllamaUrl(ollamaUrl);
    try {
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) {
        return { ok: false, status: 'error', message: `Ollama responded with HTTP ${res.status}.` };
      }
      const json = await res.json();
      const models = curateOllamaModels(json.models || []);
      if (models.length === 0) {
        return {
          ok: false,
          status: 'no_models',
          models: [],
          message: `Connected to Ollama at ${base}, but no local models are pulled yet (run "ollama pull qwen2.5vl" or "ollama pull gemma3").`
        };
      }
      return {
        ok: true,
        status: 'ok',
        models,
        message: `Connected to Ollama! Found ${models.length} local model(s).`
      };
    } catch (err) {
      return {
        ok: false,
        status: 'unreachable',
        message: `Ollama is not reachable at ${base}. Make sure the Ollama app/daemon is running.`
      };
    }
  }

  // Gemini test: list models + minimal generateContent probe
  const key = (apiKey || '').trim();
  if (!key) {
    return { ok: false, status: 'missing_key', message: 'Please enter a Gemini API key first.' };
  }

  const ai = new GoogleGenAI({ apiKey: key });
  let models;
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const rawModels = [];
    for await (const m of pager) {
      rawModels.push(m);
    }
    models = curateModels(rawModels);
  } catch (err) {
    const formatted = formatProviderError(PROVIDERS.GEMINI, err, model || 'gemini-4-hydrogen', []);
    return {
      ok: false,
      status: 'invalid_key',
      message: formatted.userMessage.replace(/\*\*/g, '')
    };
  }

  const probeModel =
    (model && models.some(m => m.id === model) ? model : null) ||
    (models.find(m => m.tier === 'free') || models[0]).id;

  try {
    await ai.models.generateContent({
      model: probeModel,
      contents: 'Reply with OK',
      config: { maxOutputTokens: 5 }
    });
    return {
      ok: true,
      status: 'ok',
      models,
      message: `API key verified! "${probeModel}" responded cleanly (${models.length} active models loaded).`
    };
  } catch (err) {
    const formatted = formatProviderError(PROVIDERS.GEMINI, err, probeModel, models);
    return {
      ok: false,
      status: 'quota_or_model_error',
      models,
      message: `Key authenticated (${models.length} models listed), but "${probeModel}" failed: ${formatted.userMessage.replace(/\*\*/g, '')}`
    };
  }
}

/**
 * Streams responses for screenshots + prompt from Gemini, OpenRouter, or Ollama.
 */
async function streamProviderResponse({
  provider,
  apiKey,
  openrouterApiKey,
  ollamaUrl,
  model,
  prompt,
  imageBase64List,
  onChunk,
  onModelStatus
}) {
  const activeProvider = provider || PROVIDERS.GEMINI;

  if (activeProvider === PROVIDERS.OPENROUTER) {
    const key = (openrouterApiKey || '').trim();
    if (!key) {
      const err = new Error('Missing OpenRouter API Key. Please add it in Settings.');
      err.status = 401;
      throw err;
    }

    const content = [{ type: 'text', text: prompt }];
    imageBase64List.forEach(b64 => {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64}` }
      });
    });

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/101yogeshsharma/NullByte',
        'X-Title': 'NullByte'
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'user', content }]
      })
    });

    if (!res.ok) {
      const bodyText = await res.text();
      const err = new Error(bodyText || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) onChunk(delta);
        } catch (_) {
          // Ignore partial/comment SSE lines
        }
      }
    }
    return;
  }

  if (activeProvider === PROVIDERS.OLLAMA) {
    const base = normalizeOllamaUrl(ollamaUrl);
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: imageBase64List
          }
        ]
      })
    });

    if (!res.ok) {
      const bodyText = await res.text();
      const err = new Error(bodyText || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          const text = json.message && json.message.content;
          if (text) onChunk(text);
        } catch (_) {
          // Ignore malformed chunk
        }
      }
    }
    return;
  }

  // Default: Google Gemini
  const cleanKey = (apiKey || '').trim();
  const ai = new GoogleGenAI({ apiKey: cleanKey });
  const imageParts = imageBase64List.map(data => ({
    inlineData: { data, mimeType: 'image/png' }
  }));

  const responseStream = await ai.models.generateContentStream({
    model,
    contents: [{ text: prompt }, ...imageParts]
  });

  for await (const chunk of responseStream) {
    if (chunk.modelStatus && chunk.modelStatus.modelStage && onModelStatus) {
      onModelStatus(chunk.modelStatus);
    }
    if (chunk.text) {
      onChunk(chunk.text);
    }
  }
}

module.exports = {
  DEFAULT_OLLAMA_URL,
  normalizeOllamaUrl,
  fetchProviderModels,
  testProviderConnection,
  streamProviderResponse
};
