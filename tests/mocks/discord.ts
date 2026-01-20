import { vi } from 'vitest';

export interface MockDiscordResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

export function createMockFetch() {
  const mockFetch = vi.fn();
  const responses = new Map<string, MockDiscordResponse>();

  function setResponse(url: string, response: Partial<MockDiscordResponse> & { body?: any }) {
    const { body, ...rest } = response;
    responses.set(url, {
      ok: rest.ok ?? true,
      status: rest.status ?? 200,
      json: async () => body ?? {},
      text: async () => typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    });
  }

  mockFetch.mockImplementation((url: string, options?: RequestInit) => {
    const response = responses.get(url) || {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    };

    return Promise.resolve(response as Response);
  });

  return {
    mockFetch,
    setResponse,
    reset: () => {
      mockFetch.mockClear();
      responses.clear();
    },
  };
}

export function createDefaultDiscordMocks() {
  const { mockFetch, setResponse } = createMockFetch();

  // Default successful responses
  setResponse('https://discord.com/api/v10/channels/123456/messages', {
    ok: true,
    status: 200,
    body: { id: 'msg-123' },
  });

  setResponse('https://discord.com/api/v10/channels/123456/messages/msg-123', {
    ok: true,
    status: 200,
    body: { id: 'msg-123', content: 'Test message content' },
  });

  setResponse('https://discord.com/api/v10/channels/123456/messages/msg-123/threads', {
    ok: true,
    status: 200,
    body: { id: 'thread-123' },
  });

  setResponse('https://discord.com/api/v10/channels/thread-123/messages', {
    ok: true,
    status: 200,
    body: { id: 'thread-msg-123' },
  });

  setResponse('https://discord.com/api/v10/channels/thread-123', {
    ok: true,
    status: 200,
    body: { id: 'thread-123' },
  });

  setResponse('https://discord.com/api/v10/channels/123456/messages/msg-123/reactions/%E2%9C%85/@me', {
    ok: true,
    status: 204,
    body: {},
  });

  setResponse('https://discord.com/api/v10/channels/thread-123/thread-members/user-123', {
    ok: true,
    status: 204,
    body: {},
  });

  return { mockFetch, setResponse };
}
