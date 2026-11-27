const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDERS,
  isAbortError,
  isOverloadError,
  formatProviderError
} = require('../modelCatalog');
const { streamProviderResponse } = require('../providerClient');

function createSseStream(chunks, { delayMs = 0, onCancel } = {}) {
  const encoder = new TextEncoder();
  let index = 0;
  let timer = null;

  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const nextChunk = chunks[index++];
      if (delayMs > 0) {
        return new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.enqueue(encoder.encode(nextChunk));
            resolve();
          }, delayMs);
        });
      }
      controller.enqueue(encoder.encode(nextChunk));
    },
    cancel(reason) {
      if (timer) clearTimeout(timer);
      if (onCancel) onCancel(reason);
    }
  });
}

describe('Overload error classification and formatting', () => {
  it('identifies transient heavy-load and high-demand errors', () => {
    assert.equal(
      isOverloadError({
        status: 503,
        message: 'got status: UNAVAILABLE. {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
      }),
      true
    );
    assert.equal(
      isOverloadError(new Error('The model is currently under heavy load. Please try again later.')),
      true
    );
    assert.equal(isOverloadError({ status: 500, message: 'Internal error' }), true);
    assert.equal(isOverloadError({ status: 502, message: 'Bad Gateway' }), true);
    assert.equal(isOverloadError({ status: 504, message: 'Gateway Timeout' }), true);
  });

  it('does not treat auth, quota limit:0, deprecated 404, ECONNREFUSED, or AbortError as overload', () => {
    const abortErr = new Error('Cancelled');
    abortErr.name = 'AbortError';
    assert.equal(isOverloadError(abortErr), false);
    assert.equal(isOverloadError({ status: 401, message: 'API key not valid' }), false);
    assert.equal(isOverloadError({ status: 404, message: 'Not found' }), false);
    assert.equal(isOverloadError({ status: 402, message: 'Insufficient credits' }), false);
    assert.equal(
      isOverloadError({
        status: 429,
        message: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota limit: 0' } })
      }),
      false
    );
    assert.equal(isOverloadError(new Error('fetch failed: ECONNREFUSED')), false);
  });

  it('formats Gemini and OpenRouter heavy-load errors clearly', () => {
    const geminiMsg = formatProviderError(
      PROVIDERS.GEMINI,
      {
        status: 503,
        message: 'got status: UNAVAILABLE. {"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'
      },
      'gemini-4-hydrogen',
      [{ id: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', tier: 'free' }]
    );
    assert.equal(geminiMsg.shouldMarkDeprecated, false);
    assert.match(geminiMsg.userMessage, /Heavy Load/i);

    const orMsg = formatProviderError(
      PROVIDERS.OPENROUTER,
      { status: 503, message: 'The model is currently overloaded' },
      'google/gemma-3-27b-it:free',
      []
    );
    assert.match(orMsg.userMessage, /Heavy Load/i);
  });
});

describe('Automatic heavy-load retries (up to 2 retries / 3 total attempts)', () => {
  it('retries 2 more times on Gemini heavy-load error and succeeds on 3rd attempt', async () => {
    let attempts = 0;
    const retries = [];
    const chunks = [];

    const mockClient = {
      models: {
        async generateContentStream() {
          attempts += 1;
          if (attempts < 3) {
            const err = new Error('The model is currently under heavy load. Please try again later.');
            err.status = 503;
            throw err;
          }
          return (async function* () {
            yield { text: 'Hello ' };
            yield { text: 'World' };
          })();
        }
      }
    };

    await streamProviderResponse({
      provider: PROVIDERS.GEMINI,
      apiKey: 'test-key',
      model: 'gemini-4-hydrogen',
      prompt: 'Solve',
      imageBase64List: [],
      retryDelayMs: 1,
      client: mockClient,
      onRetry: (info) => retries.push(info),
      onChunk: (t) => chunks.push(t)
    });

    assert.equal(attempts, 3);
    assert.equal(retries.length, 2);
    assert.deepEqual(
      retries.map(r => ({ attempt: r.attempt, nextAttempt: r.nextAttempt, totalAttempts: r.totalAttempts })),
      [
        { attempt: 1, nextAttempt: 2, totalAttempts: 3 },
        { attempt: 2, nextAttempt: 3, totalAttempts: 3 }
      ]
    );
    assert.equal(chunks.join(''), 'Hello World');
  });

  it('stops after 2 retries (3 total attempts) when heavy load persists', async () => {
    let attempts = 0;
    const retries = [];

    const mockClient = {
      models: {
        async generateContentStream() {
          attempts += 1;
          const err = new Error('This model is currently experiencing high demand.');
          err.status = 503;
          throw err;
        }
      }
    };

    await assert.rejects(
      () =>
        streamProviderResponse({
          provider: PROVIDERS.GEMINI,
          apiKey: 'test-key',
          model: 'gemini-4-hydrogen',
          prompt: 'Solve',
          imageBase64List: [],
          retryDelayMs: 1,
          client: mockClient,
          onRetry: (info) => retries.push(info)
        }),
      /high demand/i
    );

    assert.equal(attempts, 3);
    assert.equal(retries.length, 2);
  });

  it('retries when heavy-load error arrives as a stream chunk error', async () => {
    let attempts = 0;
    const chunks = [];

    const mockClient = {
      models: {
        async generateContentStream() {
          attempts += 1;
          return (async function* () {
            if (attempts === 1) {
              const err = new Error('got status: UNAVAILABLE. {"error":{"code":503,"message":"The model is currently under heavy load","status":"UNAVAILABLE"}}');
              err.status = 503;
              throw err;
            }
            yield { text: 'Recovered stream' };
          })();
        }
      }
    };

    await streamProviderResponse({
      provider: PROVIDERS.GEMINI,
      apiKey: 'test-key',
      model: 'gemini-4-hydrogen',
      prompt: 'Solve',
      imageBase64List: [],
      retryDelayMs: 1,
      client: mockClient,
      onChunk: (t) => chunks.push(t)
    });

    assert.equal(attempts, 2);
    assert.equal(chunks.join(''), 'Recovered stream');
  });

  it('does not retry non-overload errors (401, 404, 429 limit:0)', async () => {
    for (const sampleErr of [
      Object.assign(new Error('API key not valid'), { status: 401 }),
      Object.assign(new Error('Model not found'), { status: 404 }),
      Object.assign(new Error('Quota exceeded limit: 0'), { status: 429 })
    ]) {
      let attempts = 0;
      const mockClient = {
        models: {
          async generateContentStream() {
            attempts += 1;
            throw sampleErr;
          }
        }
      };

      await assert.rejects(() =>
        streamProviderResponse({
          provider: PROVIDERS.GEMINI,
          apiKey: 'test-key',
          model: 'gemini-4-hydrogen',
          prompt: 'Solve',
          imageBase64List: [],
          retryDelayMs: 1,
          client: mockClient
        })
      );
      assert.equal(attempts, 1);
    }
  });

  it('retries OpenRouter 503 overload errors twice and succeeds on 3rd attempt', async () => {
    let attempts = 0;
    const chunks = [];

    const mockFetch = async () => {
      attempts += 1;
      if (attempts < 3) {
        return {
          ok: false,
          status: 503,
          async text() {
            return 'Model currently overloaded';
          }
        };
      }
      return {
        ok: true,
        status: 200,
        body: createSseStream([
          'data: {"choices":[{"delta":{"content":"OK"}}]}\n',
          'data: [DONE]\n'
        ])
      };
    };

    await streamProviderResponse({
      provider: PROVIDERS.OPENROUTER,
      openrouterApiKey: 'or-key',
      model: 'google/gemma-3-27b-it:free',
      prompt: 'Solve',
      imageBase64List: [],
      retryDelayMs: 1,
      fetchImpl: mockFetch,
      onChunk: (t) => chunks.push(t)
    });

    assert.equal(attempts, 3);
    assert.equal(chunks.join(''), 'OK');
  });
});

describe('AbortController cancellation (Cmd/Ctrl+Shift+X stop fetching)', () => {
  it('immediately aborts an in-flight Gemini stream without retrying', async () => {
    const controller = new AbortController();
    const chunks = [];
    let attempts = 0;
    let passedAbortSignal = null;

    const mockClient = {
      models: {
        async generateContentStream(params) {
          attempts += 1;
          passedAbortSignal = params.config && params.config.abortSignal;
          return (async function* () {
            yield { text: 'First chunk' };
            controller.abort();
            // Simulate a slow chunk that would stall if not aborted cleanly
            await new Promise(resolve => setTimeout(resolve, 200));
            yield { text: 'Should never arrive' };
          })();
        }
      }
    };

    const start = Date.now();
    await assert.rejects(
      () =>
        streamProviderResponse({
          provider: PROVIDERS.GEMINI,
          apiKey: 'test-key',
          model: 'gemini-4-hydrogen',
          prompt: 'Solve',
          imageBase64List: [],
          signal: controller.signal,
          client: mockClient,
          onChunk: (t) => chunks.push(t)
        }),
      (err) => isAbortError(err)
    );

    assert.ok(Date.now() - start < 150, 'Expected immediate abort instead of waiting for slow generator');
    assert.equal(passedAbortSignal, controller.signal);
    assert.equal(attempts, 1);
    assert.deepEqual(chunks, ['First chunk']);
  });

  it('cancels retry backoff sleep immediately without firing the next retry', async () => {
    const controller = new AbortController();
    let attempts = 0;

    const mockClient = {
      models: {
        async generateContentStream() {
          attempts += 1;
          const err = new Error('The model is currently under heavy load.');
          err.status = 503;
          throw err;
        }
      }
    };

    const start = Date.now();
    await assert.rejects(
      () =>
        streamProviderResponse({
          provider: PROVIDERS.GEMINI,
          apiKey: 'test-key',
          model: 'gemini-4-hydrogen',
          prompt: 'Solve',
          imageBase64List: [],
          signal: controller.signal,
          retryDelayMs: 5000,
          onRetry: () => {
            setTimeout(() => controller.abort(), 15);
          },
          client: mockClient
        }),
      (err) => isAbortError(err)
    );

    assert.ok(Date.now() - start < 500, 'Expected retry wait to abort immediately');
    assert.equal(attempts, 1);
  });

  it('cancels OpenRouter fetch reader cleanly on abort', async () => {
    const controller = new AbortController();
    const chunks = [];
    let readerCancelled = false;

    const mockFetch = async (_url, opts) => {
      assert.equal(opts.signal, controller.signal);
      return {
        ok: true,
        status: 200,
        body: createSseStream(
          [
            'data: {"choices":[{"delta":{"content":"Part1"}}]}\n',
            'data: {"choices":[{"delta":{"content":"Part2"}}]}\n'
          ],
          {
            delayMs: 30,
            onCancel: () => {
              readerCancelled = true;
            }
          }
        )
      };
    };

    await assert.rejects(
      () =>
        streamProviderResponse({
          provider: PROVIDERS.OPENROUTER,
          openrouterApiKey: 'or-key',
          model: 'google/gemma-3-27b-it:free',
          prompt: 'Solve',
          imageBase64List: [],
          signal: controller.signal,
          fetchImpl: mockFetch,
          onChunk: (t) => {
            chunks.push(t);
            controller.abort();
          }
        }),
      (err) => isAbortError(err)
    );

    assert.equal(readerCancelled, true);
    assert.deepEqual(chunks, ['Part1']);
  });

  it('retries Ollama 503 overload and cancels Ollama stream on abort', async () => {
    let attempts = 0;
    const chunks = [];
    const controller = new AbortController();
    let readerCancelled = false;

    const mockRetryFetch = async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 503,
          async text() {
            return 'Server is busy';
          }
        };
      }
      return {
        ok: true,
        status: 200,
        body: createSseStream([
          '{"message":{"content":"Local OK"}}\n'
        ])
      };
    };

    await streamProviderResponse({
      provider: PROVIDERS.OLLAMA,
      ollamaUrl: 'http://localhost:11434',
      model: 'qwen2.5vl:7b',
      prompt: 'Solve',
      imageBase64List: [],
      retryDelayMs: 1,
      fetchImpl: mockRetryFetch,
      onChunk: (t) => chunks.push(t)
    });

    assert.equal(attempts, 2);
    assert.deepEqual(chunks, ['Local OK']);

    const mockAbortFetch = async (_url, opts) => {
      assert.equal(opts.signal, controller.signal);
      return {
        ok: true,
        status: 200,
        body: createSseStream(
          [
            '{"message":{"content":"One"}}\n',
            '{"message":{"content":"Two"}}\n'
          ],
          {
            delayMs: 30,
            onCancel: () => {
              readerCancelled = true;
            }
          }
        )
      };
    };

    const abortedChunks = [];
    await assert.rejects(
      () =>
        streamProviderResponse({
          provider: PROVIDERS.OLLAMA,
          ollamaUrl: 'http://localhost:11434',
          model: 'qwen2.5vl:7b',
          prompt: 'Solve',
          imageBase64List: [],
          signal: controller.signal,
          fetchImpl: mockAbortFetch,
          onChunk: (t) => {
            abortedChunks.push(t);
            controller.abort();
          }
        }),
      (err) => isAbortError(err)
    );

    assert.equal(readerCancelled, true);
    assert.deepEqual(abortedChunks, ['One']);
  });
});
