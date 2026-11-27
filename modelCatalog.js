const PROVIDERS = {
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter',
  OLLAMA: 'ollama'
};

const FALLBACK_MODELS = [
  { id: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', tier: 'free', isDefault: true },
  { id: 'gemma-4-31b-it', displayName: 'Gemma 4 31B', tier: 'free', isDefault: false },
  { id: 'gemma-4-26b-a4b-it', displayName: 'Gemma 4 26B MoE', tier: 'free', isDefault: false },
  { id: 'gemini-4-carbon', displayName: 'Gemini 4 Carbon', tier: 'paid', isDefault: false },
  { id: 'gemini-4-argon', displayName: 'Gemini 4 Argon', tier: 'paid', isDefault: false },
  { id: 'gemini-4-neon', displayName: 'Gemini 4 Neon', tier: 'paid', isDefault: false }
];

const OPENROUTER_FALLBACK_MODELS = [
  { id: 'google/gemma-3-27b-it:free', displayName: 'Gemma 3 27B (OpenRouter)', tier: 'free', isDefault: true },
  { id: 'qwen/qwen2.5-vl-72b-instruct:free', displayName: 'Qwen 2.5 VL 72B', tier: 'free', isDefault: false },
  { id: 'meta-llama/llama-3.2-11b-vision-instruct:free', displayName: 'Llama 3.2 11B Vision', tier: 'free', isDefault: false }
];

const OLLAMA_VISION_HINTS = ['vl', 'vision', 'llava', 'gemma3', 'gemma4', 'minicpm-v', 'moondream', 'bakllava'];

const EXCLUDED_VARIANT_REGEX =
  /(?:-tts|-audio|native-audio|-live|-image|-transcribe|nano-banana|lyria|robotics|embedding|aqa|bisect|learnlm|customtools|computer-use|-omni-|-\d{3}$|-\d{2}-\d{2}$|-exp-\d+)/i;

const LATEST_ALIAS_REGEX = /-latest$/i;

const DEPRECATION_TEXT_REGEX =
  /\b(deprecated|deprecation|shut\s*down|shutdown|retired|discontinued|legacy|end[- ]of[- ]life|no longer supported)\b/i;

const RETIRED_STAGES = new Set(['LEGACY', 'DEPRECATED', 'RETIRED']);

/**
 * Normalizes a model resource name (strips leading "models/").
 */
function normalizeModelId(model) {
  const raw = typeof model === 'string' ? model : (model && (model.name || model.id)) || '';
  return raw.replace(/^models\//, '').trim();
}

/**
 * Classifies a model as 'free' or 'paid' on Google AI Studio.
 */
function getModelTier(modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  if (id.startsWith('gemma-')) return 'free';
  if (id.includes('hydrogen')) return 'free';
  if (id.includes('-flash') && !id.includes('-pro')) return 'free';
  return 'paid';
}

/**
 * Extracts numeric version for Gemini or Gemma model IDs (e.g., gemini-4-hydrogen -> 4, gemini-3.8-flash -> 3.8).
 */
function parseGenerationVersion(id, familyPrefix) {
  const match = id.match(new RegExp(`^${familyPrefix}-(\\d+(?:\\.\\d+)?)`, 'i'));
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Extracts Gemma parameter count in billions for sorting (e.g., gemma-4-31b-it -> 31).
 */
function parseGemmaParamSize(id) {
  const match = id.match(/-(\d+(?:\.\d+)?)b(?:-|$)/i);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Returns true if the model metadata indicates it is deprecated, retired, or non-chat.
 */
function isExcludedModel(model, rejectedIds = new Set()) {
  const id = normalizeModelId(model);
  if (!id) return true;
  if (!(id.startsWith('gemini-') || id.startsWith('gemma-'))) return true;
  if (rejectedIds.has(id)) return true;
  if (LATEST_ALIAS_REGEX.test(id)) return true;
  if (EXCLUDED_VARIANT_REGEX.test(id)) return true;

  const actions = model.supportedActions || model.supportedGenerationMethods || [];
  if (Array.isArray(actions) && actions.length > 0 && !actions.includes('generateContent')) {
    return true;
  }

  const stage = model.modelStatus && model.modelStatus.modelStage;
  if (stage && RETIRED_STAGES.has(stage)) return true;

  if (model.description && DEPRECATION_TEXT_REGEX.test(model.description)) {
    return true;
  }

  if (id.startsWith('gemini-')) {
    const ver = parseGenerationVersion(id, 'gemini');
    // Gemini 1.x and 2.x (2.0 shut down, 2.5 deprecated/superseded) are excluded.
    if (ver > 0 && ver < 3) return true;
  }

  return false;
}

/**
 * Reduces a Gemini 3.x list (when Gemini 4+ isn't present) to the highest minor version per sub-tier.
 */
function keepLatestPerSubTier(geminiModels) {
  const byRole = new Map();
  for (const m of geminiModels) {
    let role = 'other';
    if (m.id.includes('flash-lite')) role = 'flash-lite';
    else if (m.id.includes('-flash')) role = 'flash';
    else if (m.id.includes('-pro')) role = 'pro';
    else {
      role = m.id.replace(/^gemini-\d+(?:\.\d+)?-?/i, '').replace(/-preview$/i, '') || 'base';
    }

    const existing = byRole.get(role);
    if (!existing) {
      byRole.set(role, m);
      continue;
    }

    const verDiff = parseGenerationVersion(m.id, 'gemini') - parseGenerationVersion(existing.id, 'gemini');
    const existingIsPreview = existing.id.includes('-preview');
    const currentIsPreview = m.id.includes('-preview');

    if (verDiff > 0 || (verDiff === 0 && existingIsPreview && !currentIsPreview)) {
      byRole.set(role, m);
    }
  }
  return Array.from(byRole.values());
}

/**
 * Deduplicates models inside the latest Gemini major generation (e.g., prefers GA over -preview and higher minor versions).
 */
function deduplicateSameGeneration(geminiModels) {
  const byFamilyName = new Map();
  for (const m of geminiModels) {
    const key = m.id
      .replace(/^gemini-\d+(?:\.\d+)?-?/i, '')
      .replace(/-preview$/i, '');

    const existing = byFamilyName.get(key);
    if (!existing) {
      byFamilyName.set(key, m);
      continue;
    }

    const verDiff = parseGenerationVersion(m.id, 'gemini') - parseGenerationVersion(existing.id, 'gemini');
    const existingIsPreview = existing.id.includes('-preview');
    const currentIsPreview = m.id.includes('-preview');

    if (verDiff > 0 || (verDiff === 0 && existingIsPreview && !currentIsPreview)) {
      byFamilyName.set(key, m);
    }
  }
  return Array.from(byFamilyName.values());
}

/**
 * Filters raw API models down to only active, non-deprecated, latest-generation models with free/paid metadata.
 */
function curateModels(rawModels = [], rejectedIds = new Set()) {
  const normalized = [];
  const seen = new Set();

  for (const m of rawModels) {
    const id = normalizeModelId(m);
    if (seen.has(id) || isExcludedModel(m, rejectedIds)) continue;
    seen.add(id);

    normalized.push({
      id,
      displayName: (m.displayName || id).replace(/\s*\(.*?\)\s*$/, '').trim() || id,
      tier: getModelTier(id),
      isDefault: false
    });
  }

  const geminiAll = normalized.filter(m => m.id.startsWith('gemini-'));
  const gemmaAll = normalized.filter(m => m.id.startsWith('gemma-'));

  let curatedGemini = [];
  if (geminiAll.length > 0) {
    const maxGeminiMajor = Math.max(
      ...geminiAll.map(m => Math.floor(parseGenerationVersion(m.id, 'gemini')))
    );
    const topMajorGemini = geminiAll.filter(
      m => Math.floor(parseGenerationVersion(m.id, 'gemini')) === maxGeminiMajor
    );

    if (maxGeminiMajor >= 4) {
      curatedGemini = deduplicateSameGeneration(topMajorGemini);
    } else {
      curatedGemini = keepLatestPerSubTier(topMajorGemini);
    }

    // Ensure at least one free Gemini model (e.g. latest Flash) survives if the top major only lists paid models
    if (!curatedGemini.some(m => m.tier === 'free')) {
      const freeFallback = geminiAll
        .filter(m => m.tier === 'free')
        .sort((a, b) => parseGenerationVersion(b.id, 'gemini') - parseGenerationVersion(a.id, 'gemini'));
      if (freeFallback.length > 0) {
        curatedGemini.push(freeFallback[0]);
      }
    }
  }

  let curatedGemma = [];
  if (gemmaAll.length > 0) {
    const maxGemmaMajor = Math.max(
      ...gemmaAll.map(m => Math.floor(parseGenerationVersion(m.id, 'gemma')))
    );
    curatedGemma = gemmaAll
      .filter(m => Math.floor(parseGenerationVersion(m.id, 'gemma')) === maxGemmaMajor)
      .sort((a, b) => parseGemmaParamSize(b.id) - parseGemmaParamSize(a.id));
  }

  const combined = [...curatedGemini, ...curatedGemma];
  if (combined.length === 0) {
    return getFallbackModels(rejectedIds);
  }

  const defaultModel = pickDefaultFreeModel(combined);
  combined.forEach(m => {
    m.isDefault = !!(defaultModel && m.id === defaultModel.id);
  });

  // Sort order: Default Free Gemini -> Other Free Gemini -> Free Gemma -> Paid Gemini
  combined.sort((a, b) => {
    const rank = (m) => {
      if (m.isDefault) return 0;
      if (m.tier === 'free' && m.id.startsWith('gemini-')) return 1;
      if (m.tier === 'free' && m.id.startsWith('gemma-')) return 2;
      return 3;
    };
    const rDiff = rank(a) - rank(b);
    if (rDiff !== 0) return rDiff;
    if (a.id.startsWith('gemma-') && b.id.startsWith('gemma-')) {
      return parseGemmaParamSize(b.id) - parseGemmaParamSize(a.id);
    }
    return a.displayName.localeCompare(b.displayName);
  });

  return combined;
}

/**
 * Picks the best Free-tier default model (Gemini Hydrogen preferred, then Flash, then Gemma).
 */
function pickDefaultFreeModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;

  const freeGemini = models.filter(m => m.tier === 'free' && m.id.startsWith('gemini-'));
  const hydrogen = freeGemini
    .filter(m => m.id.includes('hydrogen'))
    .sort((a, b) => parseGenerationVersion(b.id, 'gemini') - parseGenerationVersion(a.id, 'gemini'));
  if (hydrogen.length > 0) return hydrogen[0];

  const flash = freeGemini
    .filter(m => m.id.includes('-flash') && !m.id.includes('flash-lite'))
    .sort((a, b) => parseGenerationVersion(b.id, 'gemini') - parseGenerationVersion(a.id, 'gemini'));
  if (flash.length > 0) return flash[0];

  if (freeGemini.length > 0) return freeGemini[0];

  const freeAny = models.filter(m => m.tier === 'free');
  return freeAny[0] || models[0];
}

function getFallbackModels(rejectedIds = new Set()) {
  const available = FALLBACK_MODELS.filter(m => !rejectedIds.has(m.id)).map(m => ({ ...m }));
  return available.length > 0 ? available : FALLBACK_MODELS.map(m => ({ ...m }));
}

/**
 * Returns true if an error represents user/request cancellation.
 */
function isAbortError(error) {
  if (!error) return false;
  return error.name === 'AbortError' || error.code === 'ABORT_ERR';
}

/**
 * Extracts normalized HTTP status and nested JSON API error details (handling SDK SSE prefixes).
 */
function extractErrorDetails(error) {
  const rawMessage = (error && error.message) ? String(error.message) : 'Unknown error occurred.';
  let status = error && typeof error.status === 'number' ? error.status : null;
  let apiErrorMessage = rawMessage;
  let apiErrorStatus = '';

  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart));
      if (parsed && parsed.error) {
        apiErrorMessage = parsed.error.message || rawMessage;
        apiErrorStatus = parsed.error.status || '';
        if (status === null && typeof parsed.error.code === 'number') {
          status = parsed.error.code;
        }
      }
    } catch (_) {
      // rawMessage is plain text
    }
  }

  return {
    status,
    rawMessage,
    apiErrorMessage,
    apiErrorStatus,
    lower: `${apiErrorStatus} ${apiErrorMessage} ${rawMessage}`.toLowerCase()
  };
}

/**
 * Returns true if the error indicates transient heavy load / high demand / server overload that should retry.
 */
function isOverloadError(error) {
  if (!error || isAbortError(error)) return false;
  const { status, lower, apiErrorStatus } = extractErrorDetails(error);

  if (
    status === 400 ||
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    status === 422 ||
    lower.includes('limit: 0') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('insufficient credits') ||
    lower.includes('econnrefused')
  ) {
    return false;
  }

  if (status === 500 || status === 502 || status === 503 || status === 504 || status === 529) {
    return true;
  }

  const normalizedApiStatus = String(apiErrorStatus || '').toUpperCase();
  if (normalizedApiStatus === 'UNAVAILABLE' || normalizedApiStatus === 'INTERNAL') {
    return true;
  }

  return (
    /(?:heavy load|high demand|overloaded|model is busy|server is busy|temporarily unavailable|service unavailable|at capacity|currently unavailable)/i.test(lower) ||
    (/\bunavailable\b/i.test(lower) && !lower.includes('quota'))
  );
}

/**
 * Extracts a readable message and status code from @google/genai errors and returns a user-friendly response.
 */
function formatGeminiError(error, modelId, models = []) {
  const { status, apiErrorMessage, lower } = extractErrorDetails(error);
  const modelMeta = models.find(m => m.id === modelId);
  const displayName = (modelMeta && modelMeta.displayName) || modelId;
  const isPaidModel = modelMeta ? modelMeta.tier === 'paid' : getModelTier(modelId) === 'paid';

  // 1. Model retired / removed / deprecated
  if (
    status === 404 ||
    lower.includes('not_found') ||
    lower.includes('is not found') ||
    lower.includes('deprecated') ||
    lower.includes('retired') ||
    lower.includes('no longer supported')
  ) {
    return {
      shouldMarkDeprecated: true,
      userMessage:
        `**Model Deprecated or Unavailable**\n\n` +
        `**${displayName}** is deprecated or no longer available. It has been removed from your model list.\n\n` +
        `Please select a **Free** model such as **Gemini 4 Hydrogen** or **Gemma 4** from the model dropdown (Cmd/Ctrl+Shift+M) and try again.`
    };
  }

  // 2. Invalid / missing / rejected API key
  if (
    status === 401 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('unauthenticated') ||
    lower.includes('access_token_type_unsupported')
  ) {
    return {
      shouldMarkDeprecated: false,
      userMessage:
        `**Invalid API Key**\n\n` +
        `Google rejected your API key. Open **Settings** from the tray icon and make sure you copied the full key from Google AI Studio (**aistudio.google.com/app/apikey**) using the **Copy key** button.`
    };
  }

  // 3. Transient server overload / heavy load (after automatic retries)
  if (isOverloadError(error)) {
    return {
      shouldMarkDeprecated: false,
      userMessage:
        `**Model Temporarily Under Heavy Load**\n\n` +
        `**${displayName}** is currently experiencing high demand (automatic retries failed).\n\n` +
        `Please try again in a few moments or switch to another **Free** model such as **Gemma 4** or **Flash**.`
    };
  }

  // 4. Free tier restriction, quota exhaustion, or paid-only model blocked
  const isQuotaOrTierBlock =
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('limit: 0') ||
    lower.includes('quota') ||
    lower.includes('free tier') ||
    lower.includes('billing') ||
    (status === 403 && !lower.includes('api key'));

  if (isQuotaOrTierBlock) {
    if (isPaidModel) {
      return {
        shouldMarkDeprecated: false,
        userMessage:
          `**Paid Tier Model Selected**\n\n` +
          `**${displayName}** is not available on the Free Tier (requires a paid API billing plan).\n\n` +
          `Please switch to a **Free** model — try **Gemini 4 Hydrogen** (or a **Flash** / **Gemma** model) from the model selector.`
      };
    }

    return {
      shouldMarkDeprecated: false,
      userMessage:
        `**Free Tier Limit Reached / Unavailable**\n\n` +
        `**${displayName}** could not run on your current key's Free Tier quota (or hit a rate limit).\n\n` +
        `Try using **Gemini 4 Hydrogen** or a **Flash** / **Gemma** model, wait a minute if you hit the per-minute limit, or check your project's quota at **aistudio.google.com/rate-limit**.`
    };
  }

  return {
    shouldMarkDeprecated: false,
    userMessage: `**Error**: ${apiErrorMessage}\n\nCheck your API Key in Settings or try switching to **Gemini 4 Hydrogen** (Free).`
  };
}

/**
 * Filters OpenRouter models down to screenshot/vision-capable models, prioritizing free models first.
 */
function curateOpenRouterModels(rawModels = []) {
  const visionModels = [];
  const seen = new Set();

  for (const m of rawModels) {
    const id = (m && m.id ? String(m.id) : '').trim();
    if (!id || seen.has(id)) continue;

    const arch = m.architecture || {};
    const inputModalities = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
    const modalityStr = String(arch.modality || '').toLowerCase();
    const idLower = id.toLowerCase();

    const supportsImage =
      inputModalities.includes('image') ||
      modalityStr.includes('image') ||
      OLLAMA_VISION_HINTS.some(hint => idLower.includes(hint)) ||
      idLower.includes('gemini-');

    if (!supportsImage) continue;
    seen.add(id);

    const pricing = m.pricing || {};
    const isFree =
      idLower.endsWith(':free') ||
      (String(pricing.prompt) === '0' && String(pricing.completion) === '0');

    const cleanName = (m.name || id).replace(/\s*\(free\)\s*$/i, '').trim();
    visionModels.push({
      id,
      displayName: cleanName,
      tier: isFree ? 'free' : 'paid',
      isDefault: false
    });
  }

  const freeOnly = visionModels.filter(m => m.tier === 'free');
  const paidOnly = visionModels.filter(m => m.tier === 'paid').slice(0, 12);
  const selected = [...freeOnly, ...paidOnly];

  if (selected.length === 0) {
    return OPENROUTER_FALLBACK_MODELS.map(m => ({ ...m }));
  }

  selected[0].isDefault = true;
  return selected;
}

/**
 * Formats Ollama local /api/tags entries for NullByte, prioritizing vision-capable models.
 */
function curateOllamaModels(rawModels = []) {
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    return [];
  }

  const mapped = rawModels
    .filter(m => m && m.name)
    .map(m => {
      const id = String(m.name).trim();
      const lower = id.toLowerCase();
      const isVision = OLLAMA_VISION_HINTS.some(h => lower.includes(h));
      return {
        id,
        displayName: id,
        tier: 'local',
        isVision,
        isDefault: false
      };
    });

  mapped.sort((a, b) => {
    if (a.isVision !== b.isVision) return a.isVision ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  if (mapped.length > 0) {
    mapped[0].isDefault = true;
  }
  return mapped.map(({ isVision, ...rest }) => rest);
}

/**
 * Normalizes errors across Gemini, OpenRouter, and Ollama into user-friendly Markdown guidance.
 */
function formatProviderError(provider, error, modelId, models = []) {
  if (!provider || provider === PROVIDERS.GEMINI) {
    return formatGeminiError(error, modelId, models);
  }

  const status = error && typeof error.status === 'number' ? error.status : null;
  const rawMessage = (error && error.message) ? String(error.message) : 'Unknown error occurred.';
  const lower = rawMessage.toLowerCase();
  const modelMeta = models.find(m => m.id === modelId);
  const displayName = (modelMeta && modelMeta.displayName) || modelId;

  if (provider === PROVIDERS.OPENROUTER) {
    if (status === 401 || lower.includes('unauthorized') || lower.includes('invalid auth')) {
      return {
        shouldMarkDeprecated: false,
        userMessage:
          `**Invalid OpenRouter API Key**\n\n` +
          `Please verify your OpenRouter key in **Settings** (**openrouter.ai/keys**).`
      };
    }
    if (status === 402 || status === 429 || lower.includes('credit') || lower.includes('rate limit') || lower.includes('quota')) {
      return {
        shouldMarkDeprecated: false,
        userMessage:
          `**OpenRouter Limit / Credits Required**\n\n` +
          `**${displayName}** could not run because of rate limits or missing credits.\n\n` +
          `Try selecting a **Free** (:free) vision model from the dropdown or wait a moment before retrying.`
      };
    }
    if (status === 404 || lower.includes('no endpoints found')) {
      return {
        shouldMarkDeprecated: true,
        userMessage:
          `**Model Unavailable on OpenRouter**\n\n` +
          `**${displayName}** is currently unavailable. Please select another **Free** vision model from the dropdown.`
      };
    }
    if (isOverloadError(error)) {
      return {
        shouldMarkDeprecated: false,
        userMessage:
          `**Model Temporarily Under Heavy Load**\n\n` +
          `**${displayName}** is currently experiencing high demand (automatic retries failed).\n\n` +
          `Please try again in a few moments or switch to another **Free** (:free) vision model.`
      };
    }
    return {
      shouldMarkDeprecated: false,
      userMessage: `**OpenRouter Error**: ${rawMessage}`
    };
  }

  if (provider === PROVIDERS.OLLAMA) {
    if (lower.includes('econnrefused') || lower.includes('fetch failed')) {
      return {
        shouldMarkDeprecated: false,
        userMessage:
          `**Ollama Not Reachable**\n\n` +
          `Could not connect to local Ollama. Make sure **Ollama** is running (and check the Base URL in **Settings**).`
      };
    }
    if (status === 404 || lower.includes('not found')) {
      return {
        shouldMarkDeprecated: false,
        userMessage:
          `**Ollama Model Not Pulled**\n\n` +
          `**${displayName}** was not found locally. Run \`ollama pull ${modelId}\` (for screenshots, use a vision model like \`qwen2.5vl\` or \`gemma3\`).`
      };
    }
    return {
      shouldMarkDeprecated: false,
      userMessage: `**Ollama Error**: ${rawMessage}`
    };
  }

  return formatGeminiError(error, modelId, models);
}

module.exports = {
  PROVIDERS,
  FALLBACK_MODELS,
  OPENROUTER_FALLBACK_MODELS,
  normalizeModelId,
  getModelTier,
  curateModels,
  curateOpenRouterModels,
  curateOllamaModels,
  pickDefaultFreeModel,
  getFallbackModels,
  isAbortError,
  isOverloadError,
  formatGeminiError,
  formatProviderError
};
