const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDERS,
  curateModels,
  curateOpenRouterModels,
  curateOllamaModels,
  pickDefaultFreeModel,
  getModelTier,
  formatProviderError
} = require('../modelCatalog');
const { normalizeOllamaUrl } = require('../providerClient');

describe('Gemini model curation & deprecation filtering', () => {
  const sampleApiModels = [
    { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-tts', displayName: 'Gemini 3.8 Flash TTS', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image', displayName: 'Gemini 3.1 Flash Image', supportedActions: ['generateContent'] },
    { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4-carbon', displayName: 'Gemini 4 Carbon', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4-argon', displayName: 'Gemini 4 Argon', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4-neon', displayName: 'Gemini 4 Neon', supportedActions: ['generateContent'] },
    { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3 27B', supportedActions: ['generateContent'] },
    { name: 'models/gemma-4-31b-it', displayName: 'Gemma 4 31B', supportedActions: ['generateContent'] },
    { name: 'models/gemma-4-26b-a4b-it', displayName: 'Gemma 4 26B A4B', supportedActions: ['generateContent'] },
    { name: 'models/text-embedding-004', displayName: 'Text Embedding', supportedActions: ['embedContent'] }
  ];

  it('keeps only Gemini 4 and Gemma 4 when Gemini 4 is released and defaults to gemini-4-hydrogen', () => {
    const curated = curateModels(sampleApiModels);
    assert.deepEqual(
      curated.map(m => m.id),
      [
        'gemini-4-hydrogen',
        'gemma-4-31b-it',
        'gemma-4-26b-a4b-it',
        'gemini-4-argon',
        'gemini-4-carbon',
        'gemini-4-neon'
      ]
    );
    assert.equal(curated[0].tier, 'free');
    assert.equal(curated[0].isDefault, true);
    assert.equal(curated.find(m => m.id === 'gemini-4-carbon').tier, 'paid');
    assert.equal(curated.find(m => m.id === 'gemma-4-31b-it').tier, 'free');
  });

  it('excludes deprecated descriptions, retired modelStatus stages, and runtime rejected IDs', () => {
    const curated = curateModels(
      [
        ...sampleApiModels,
        {
          name: 'models/gemini-4-old',
          displayName: 'Gemini 4 Old',
          description: 'This model is deprecated and will be shut down.',
          supportedActions: ['generateContent']
        },
        {
          name: 'models/gemini-4-legacy',
          displayName: 'Gemini 4 Legacy',
          modelStatus: { modelStage: 'LEGACY' },
          supportedActions: ['generateContent']
        }
      ],
      new Set(['gemini-4-argon'])
    );
    const ids = curated.map(m => m.id);
    assert.equal(ids.includes('gemini-4-old'), false);
    assert.equal(ids.includes('gemini-4-legacy'), false);
    assert.equal(ids.includes('gemini-4-argon'), false);
  });

  it('automatically promotes future Gemini 5 generation over Gemini 4', () => {
    const future = curateModels([
      ...sampleApiModels,
      { name: 'models/gemini-5-hydrogen', displayName: 'Gemini 5 Hydrogen', supportedActions: ['generateContent'] },
      { name: 'models/gemini-5-carbon', displayName: 'Gemini 5 Carbon', supportedActions: ['generateContent'] }
    ]);
    assert.deepEqual(
      future.filter(m => m.id.startsWith('gemini-')).map(m => m.id),
      ['gemini-5-hydrogen', 'gemini-5-carbon']
    );
    assert.equal(pickDefaultFreeModel(future).id, 'gemini-5-hydrogen');
  });

  it('falls back to highest 3.x Flash + Pro if Gemini 4 is not listed', () => {
    const v3Only = curateModels(sampleApiModels.filter(m => !m.name.includes('gemini-4')));
    assert.equal(v3Only[0].id, 'gemini-3.8-flash');
    assert.equal(v3Only[0].tier, 'free');
    assert.equal(v3Only.some(m => m.id === 'gemini-3.5-flash'), false);
  });

  it('classifies tiers correctly', () => {
    assert.equal(getModelTier('gemini-4-hydrogen'), 'free');
    assert.equal(getModelTier('gemma-4-31b-it'), 'free');
    assert.equal(getModelTier('gemini-3.8-flash'), 'free');
    assert.equal(getModelTier('gemini-4-carbon'), 'paid');
    assert.equal(getModelTier('gemini-4-neon'), 'paid');
  });
});

describe('OpenRouter & Ollama model curation', () => {
  it('filters OpenRouter to vision-capable models with free models prioritized', () => {
    const curated = curateOpenRouterModels([
      {
        id: 'meta-llama/llama-3.1-8b-instruct:free',
        name: 'Text Only',
        architecture: { input_modalities: ['text'] },
        pricing: { prompt: '0', completion: '0' }
      },
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        architecture: { input_modalities: ['text', 'image'] },
        pricing: { prompt: '0.000005', completion: '0.000015' }
      },
      {
        id: 'qwen/qwen2.5-vl-72b-instruct:free',
        name: 'Qwen 2.5 VL 72B (free)',
        architecture: { input_modalities: ['text', 'image'] },
        pricing: { prompt: '0', completion: '0' }
      }
    ]);

    assert.equal(curated.length, 2);
    assert.equal(curated[0].id, 'qwen/qwen2.5-vl-72b-instruct:free');
    assert.equal(curated[0].tier, 'free');
    assert.equal(curated[0].isDefault, true);
    assert.equal(curated[1].tier, 'paid');
  });

  it('sorts Ollama vision models first and labels local tier', () => {
    const curated = curateOllamaModels([
      { name: 'llama3.2:latest' },
      { name: 'qwen2.5vl:7b' }
    ]);
    assert.deepEqual(
      curated.map(m => ({ id: m.id, tier: m.tier, isDefault: m.isDefault })),
      [
        { id: 'qwen2.5vl:7b', tier: 'local', isDefault: true },
        { id: 'llama3.2:latest', tier: 'local', isDefault: false }
      ]
    );
  });

  it('normalizes Ollama URLs', () => {
    assert.equal(normalizeOllamaUrl(''), 'http://localhost:11434');
    assert.equal(normalizeOllamaUrl('http://127.0.0.1:11434///'), 'http://127.0.0.1:11434');
  });
});

describe('Friendly error messages across providers', () => {
  const models = curateModels([
    { name: 'models/gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', supportedActions: ['generateContent'] },
    { name: 'models/gemini-4-carbon', displayName: 'Gemini 4 Carbon', supportedActions: ['generateContent'] }
  ]);

  it('prompts switching to free model when paid Gemini model fails quota', () => {
    const err = formatProviderError(
      PROVIDERS.GEMINI,
      { status: 429, message: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota limit: 0' } }) },
      'gemini-4-carbon',
      models
    );
    assert.equal(err.shouldMarkDeprecated, false);
    assert.match(err.userMessage, /not available on the Free Tier/i);
    assert.match(err.userMessage, /Gemini 4 Hydrogen/i);
  });

  it('marks 404 Gemini models deprecated', () => {
    const err = formatProviderError(
      PROVIDERS.GEMINI,
      { status: 404, message: 'models/gemini-2.0-flash is not found' },
      'gemini-2.0-flash',
      models
    );
    assert.equal(err.shouldMarkDeprecated, true);
  });

  it('formats OpenRouter credit/rate-limit errors cleanly', () => {
    const err = formatProviderError(
      PROVIDERS.OPENROUTER,
      { status: 402, message: 'Insufficient credits' },
      'openai/gpt-4o',
      []
    );
    assert.match(err.userMessage, /OpenRouter Limit/i);
  });

  it('formats Ollama unreachable errors cleanly', () => {
    const err = formatProviderError(
      PROVIDERS.OLLAMA,
      { message: 'fetch failed: ECONNREFUSED' },
      'qwen2.5vl:7b',
      []
    );
    assert.match(err.userMessage, /Ollama Not Reachable/i);
  });
});
