import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMProvider, type LLMConfig } from './llm-provider';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

function mockResponse(content: string, model = 'test-model') {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      model,
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  };
}

describe('LLMProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('creates with default config values', () => {
    const llm = new LLMProvider({ backend: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat' });
    expect(llm).toBeDefined();
  });

  it('calls DeepSeek API with correct headers', async () => {
    mockFetch.mockResolvedValue(mockResponse('Hello from DeepSeek', 'deepseek-chat'));
    const llm = new LLMProvider({ backend: 'deepseek', apiKey: 'sk-ds', model: 'deepseek-chat' });
    const res = await llm.chat([{ role: 'user', content: 'Hi' }]);
    expect(res.content).toBe('Hello from DeepSeek');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-ds' }),
      })
    );
  });

  it('calls OpenCode API', async () => {
    mockFetch.mockResolvedValue(mockResponse('Hello from OpenCode'));
    const llm = new LLMProvider({ backend: 'opencode', apiKey: 'sk-oc', model: 'claude-sonnet-4' });
    const res = await llm.chat([{ role: 'user', content: 'Hi' }]);
    expect(res.content).toBe('Hello from OpenCode');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('opencode.ai'),
      expect.anything()
    );
  });

  it('calls OpenRouter API with required headers', async () => {
    mockFetch.mockResolvedValue(mockResponse('Hello from OpenRouter'));
    const llm = new LLMProvider({ backend: 'openrouter', apiKey: 'sk-or', model: 'deepseek/deepseek-chat' });
    const res = await llm.chat([{ role: 'user', content: 'Hi' }]);
    expect(res.content).toBe('Hello from OpenRouter');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'HTTP-Referer': 'https://codenexus.dev',
          'X-Title': 'CodeNexus',
        }),
      })
    );
  });

  it('throws on non-ok API response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const llm = new LLMProvider({ backend: 'deepseek', apiKey: 'bad', model: 'deepseek-chat' });
    await expect(llm.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow('DeepSeek API error');
  });

  it('accepts custom baseURL for self-hosted endpoints', async () => {
    mockFetch.mockResolvedValue(mockResponse('Custom'));
    const llm = new LLMProvider({
      backend: 'deepseek', apiKey: 'sk', model: 'local', baseURL: 'http://localhost:11434/v1/chat/completions',
    });
    const res = await llm.chat([{ role: 'user', content: 'Hi' }]);
    expect(res.content).toBe('Custom');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.anything());
  });

  it('streams response via async generator', async () => {
    mockFetch.mockResolvedValue(mockResponse('stream'));
    const llm = new LLMProvider({ backend: 'deepseek', apiKey: 'sk', model: 'd' });
    const chunks: string[] = [];
    for await (const chunk of llm.streamChat([{ role: 'user', content: 'Hi' }])) {
      chunks.push(chunk);
    }
    expect(chunks).toContain('stream');
  });
});
