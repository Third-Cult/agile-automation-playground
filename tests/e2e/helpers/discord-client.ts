import type { E2EConfig } from '../config';

export interface DiscordMessage {
  id: string;
  content: string;
  channel_id: string;
  thread?: {
    id: string;
    name: string;
    locked?: boolean;
    archived?: boolean;
  };
  reactions?: Array<{
    emoji: { name: string };
    count: number;
  }>;
  timestamp: string;
}

export interface DiscordThread {
  id: string;
  name: string;
  locked: boolean;
  archived: boolean;
  message_count?: number;
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export class DiscordClient {
  private botToken: string;
  private channelId: string;
  private pollInterval: number;
  private pollTimeout: number;

  constructor(config: E2EConfig) {
    this.botToken = config.discord.botToken;
    this.channelId = config.discord.channelId;
    this.pollInterval = config.test.discordPollInterval;
    this.pollTimeout = config.test.discordPollTimeout;
  }

  /**
   * Make a Discord API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${DISCORD_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Discord API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // Handle 204 No Content (common for DELETE requests) - no body to parse
    if (response.status === 204) {
      return undefined as T;
    }

    // Try to parse as JSON
    const text = await response.text();
    if (!text || text.trim() === '') {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (parseError) {
      // If parsing fails, return undefined (for non-JSON responses)
      return undefined as T;
    }
  }

  /**
   * Get messages from a channel
   */
  async getChannelMessages(limit: number = 50, before?: string): Promise<DiscordMessage[]> {
    let url = `/channels/${this.channelId}/messages?limit=${limit}`;
    if (before) {
      url += `&before=${before}`;
    }

    const messages = await this.request<DiscordMessage[]>(url);
    return messages.map((msg) => ({
      ...msg,
      thread: msg.thread ? {
        id: msg.thread.id,
        name: msg.thread.name,
        locked: msg.thread.locked,
        archived: msg.thread.archived,
      } : undefined,
    }));
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(messageId: string): Promise<DiscordMessage> {
    const message = await this.request<DiscordMessage>(
      `/channels/${this.channelId}/messages/${messageId}`
    );
    return {
      ...message,
      thread: message.thread ? {
        id: message.thread.id,
        name: message.thread.name,
        locked: message.thread.locked,
        archived: message.thread.archived,
      } : undefined,
    };
  }

  /**
   * Get thread details
   */
  async getThread(threadId: string): Promise<DiscordThread> {
    const thread = await this.request<DiscordThread>(`/channels/${threadId}`);
    return {
      id: thread.id,
      name: thread.name,
      locked: thread.locked || false,
      archived: thread.archived || false,
      message_count: thread.message_count,
    };
  }

  /**
   * Get messages from a thread
   */
  async getThreadMessages(threadId: string, limit: number = 50): Promise<DiscordMessage[]> {
    const messages = await this.request<DiscordMessage[]>(
      `/channels/${threadId}/messages?limit=${limit}`
    );
    return messages.map((msg) => ({
      ...msg,
      thread: {
        id: threadId,
        name: '',
        locked: false,
        archived: false,
      },
    }));
  }

  /**
   * Find a message by PR number in content
   */
  async findMessageByPR(prNumber: number, timeout?: number): Promise<DiscordMessage | null> {
    const searchText = `PR #${prNumber}`;
    const maxTime = timeout || this.pollTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < maxTime) {
      const messages = await this.getChannelMessages(50);
      
      for (const message of messages) {
        if (message.content.includes(searchText)) {
          return message;
        }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
    }

    return null;
  }

  /**
   * Find a message by text content
   */
  async findMessageByText(searchText: string, timeout?: number): Promise<DiscordMessage | null> {
    const maxTime = timeout || this.pollTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < maxTime) {
      const messages = await this.getChannelMessages(50);
      
      for (const message of messages) {
        if (message.content.includes(searchText)) {
          return message;
        }
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
    }

    return null;
  }

  /**
   * Wait for a new message matching criteria
   */
  async waitForMessage(
    predicate: (message: DiscordMessage) => boolean,
    timeout?: number
  ): Promise<DiscordMessage | null> {
    const maxTime = timeout || this.pollTimeout;
    const startTime = Date.now();
    const seenMessageIds = new Set<string>();

    // Get initial messages to avoid matching old ones
    const initialMessages = await this.getChannelMessages(10);
    initialMessages.forEach((msg) => seenMessageIds.add(msg.id));

    while (Date.now() - startTime < maxTime) {
      const messages = await this.getChannelMessages(50);
      
      for (const message of messages) {
        if (!seenMessageIds.has(message.id) && predicate(message)) {
          return message;
        }
        seenMessageIds.add(message.id);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
    }

    return null;
  }

  /**
   * Check if a message has a specific reaction
   */
  hasReaction(message: DiscordMessage, emoji: string): boolean {
    if (!message.reactions) {
      return false;
    }
    return message.reactions.some((r) => r.emoji.name === emoji);
  }

  /**
   * Check if a message contains specific text
   */
  containsText(message: DiscordMessage, text: string): boolean {
    return message.content.includes(text);
  }

  /**
   * Delete a message (if bot has permissions)
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      // DELETE returns 204 No Content, so we don't need to parse the response
      await this.request<void>(`/channels/${this.channelId}/messages/${messageId}`, {
        method: 'DELETE',
      });
    } catch (error: any) {
      // Ignore if message doesn't exist or bot doesn't have permission
      if (error.message && !error.message.includes('404') && !error.message.includes('403')) {
        throw error;
      }
    }
  }

  /**
   * Delete a thread (if bot has permissions)
   * Threads are channels, so we delete the channel
   */
  async deleteThread(threadId: string): Promise<void> {
    try {
      // DELETE returns 204 No Content, so we don't need to parse the response
      // Threads are channels, so we use the thread ID as the channel ID
      await this.request<void>(`/channels/${threadId}`, {
        method: 'DELETE',
      });
    } catch (error: any) {
      // Ignore if thread doesn't exist or bot doesn't have permission
      // Also ignore 403 Forbidden (permission denied) and 404 Not Found (already deleted)
      if (error.message && !error.message.includes('404') && !error.message.includes('403')) {
        throw error;
      }
    }
  }
}
