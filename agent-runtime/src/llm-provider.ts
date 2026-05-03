export type LLMBackend = 'deepseek' | 'opencode' | 'openrouter';

export interface LLMConfig {
  backend: LLMBackend;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  baseURL?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  finishReason: string;
}

interface ChatCompletionData {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

export class LLMProvider {
  private config: LLMConfig & { maxTokens: number; temperature: number };

  constructor(config: LLMConfig) {
    this.config = {
      ...config,
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.3,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    switch (this.config.backend) {
      case 'deepseek': return this.callDeepSeek(messages);
      case 'opencode': return this.callOpenCode(messages);
      case 'openrouter': return this.callOpenRouter(messages);
    }
  }

  private async callDeepSeek(messages: LLMMessage[]): Promise<LLMResponse> {
    const url = this.config.baseURL || 'https://api.deepseek.com/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as ChatCompletionData;
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens },
      finishReason: data.choices[0].finish_reason,
    };
  }

  private async callOpenCode(messages: LLMMessage[]): Promise<LLMResponse> {
    const url = this.config.baseURL || 'https://api.opencode.ai/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });
    if (!res.ok) throw new Error(`OpenCode API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as ChatCompletionData;
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0 },
      finishReason: data.choices[0].finish_reason || 'stop',
    };
  }

  private async callOpenRouter(messages: LLMMessage[]): Promise<LLMResponse> {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://codenexus.dev',
        'X-Title': 'CodeNexus',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as ChatCompletionData;
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens },
      finishReason: data.choices[0].finish_reason,
    };
  }

  async *streamChat(messages: LLMMessage[]): AsyncGenerator<string> {
    const response = await this.chat(messages);
    yield response.content;
  }
}
