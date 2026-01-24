import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendMessage,
  createThread,
  sendThreadMessage,
  getMessage,
  editMessage,
  addReaction,
  removeReaction,
  lockThread,
  archiveThread,
  removeThreadMember,
} from '../../../.github/scripts/discord-pr-notifications/utils/discord';

// Mock fetch globally
global.fetch = vi.fn();

describe('discord', () => {
  const botToken = 'test-bot-token';
  const channelId = '123456';
  const messageId = 'msg-123';
  const threadId = 'thread-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-123' }),
      });

      const result = await sendMessage(botToken, channelId, 'Test message');

      expect(result).toEqual({ id: 'msg-123' });
      expect(global.fetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should throw error on invalid channel ID', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Channel not found',
      });

      await expect(sendMessage(botToken, 'invalid', 'Test message')).rejects.toThrow();
    });

    it('should throw error on invalid bot token', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(sendMessage('invalid-token', channelId, 'Test message')).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(sendMessage(botToken, channelId, 'Test message')).rejects.toThrow();
    });

    it('should set suppress embeds flag', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-123' }),
      });

      await sendMessage(botToken, channelId, 'Test message');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.flags).toBe(4);
    });
  });

  describe('createThread', () => {
    it('should create thread successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'thread-123' }),
      });

      const result = await createThread(botToken, channelId, messageId, 'Thread Name');

      expect(result).toEqual({ id: 'thread-123' });
      expect(global.fetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Thread Name'),
        })
      );
    });

    it('should set auto-archive duration correctly', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'thread-123' }),
      });

      await createThread(botToken, channelId, messageId, 'Thread Name');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.auto_archive_duration).toBe(1440);
    });

    it('should throw error on invalid message ID', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Message not found',
      });

      await expect(createThread(botToken, channelId, 'invalid', 'Thread Name')).rejects.toThrow();
    });
  });

  describe('sendThreadMessage', () => {
    it('should send thread message successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'thread-msg-123' }),
      });

      await sendThreadMessage(botToken, threadId, 'Thread message');

      expect(global.fetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${threadId}/messages`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw error on invalid thread ID', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Thread not found',
      });

      await expect(sendThreadMessage(botToken, 'invalid', 'Message')).rejects.toThrow();
    });

    it('should set suppress embeds flag (no link preview pop-up)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'thread-msg-123' }),
      });

      await sendThreadMessage(botToken, threadId, 'Message with [link](https://example.com)');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.flags).toBe(4);
    });
  });

  describe('getMessage', () => {
    it('should retrieve message successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-123', content: 'Test content' }),
      });

      const result = await getMessage(botToken, channelId, messageId);

      expect(result).toEqual({ id: 'msg-123', content: 'Test content' });
    });

    it('should throw error when message not found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Message not found',
      });

      await expect(getMessage(botToken, channelId, 'invalid')).rejects.toThrow();
    });
  });

  describe('editMessage', () => {
    it('should edit message successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await editMessage(botToken, channelId, messageId, 'Updated content');

      expect(global.fetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });

    it('should preserve suppress embeds flag', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await editMessage(botToken, channelId, messageId, 'Updated content');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.flags).toBe(4);
    });

    it('should handle special characters in content', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await editMessage(botToken, channelId, messageId, 'Content with <@123> and :emoji:');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.content).toContain('<@123>');
    });
  });

  describe('addReaction', () => {
    it('should add reaction successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await addReaction(botToken, channelId, messageId, '✅');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/reactions/'),
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('should handle Unicode emoji encoding', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await addReaction(botToken, channelId, messageId, '🎉');

      const call = (global.fetch as any).mock.calls[0];
      expect(call[0]).toContain(encodeURIComponent('🎉'));
    });

    it('should handle 204 status as success', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(addReaction(botToken, channelId, messageId, '✅')).resolves.not.toThrow();
    });
  });

  describe('removeReaction', () => {
    it('should remove reaction successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await removeReaction(botToken, channelId, messageId, '✅');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/reactions/'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle 404 when reaction does not exist', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      await expect(removeReaction(botToken, channelId, messageId, '✅')).resolves.not.toThrow();
    });

    it('should handle 204 status as success', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(removeReaction(botToken, channelId, messageId, '✅')).resolves.not.toThrow();
    });
  });

  describe('lockThread', () => {
    it('should lock thread successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: threadId, locked: true }),
      });

      await lockThread(botToken, threadId, true);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.locked).toBe(true);
    });

    it('should unlock thread successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: threadId, locked: false }),
      });

      await lockThread(botToken, threadId, false);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.locked).toBe(false);
    });

    it('should throw error when thread not found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Thread not found',
      });

      await expect(lockThread(botToken, 'invalid', true)).rejects.toThrow();
    });
  });

  describe('archiveThread', () => {
    it('should archive and lock thread successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: threadId, archived: true, locked: true }),
      });

      await archiveThread(botToken, threadId);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.archived).toBe(true);
      expect(body.locked).toBe(true);
    });

    it('should throw error when thread not found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Thread not found',
      });

      await expect(archiveThread(botToken, 'invalid')).rejects.toThrow();
    });
  });

  describe('removeThreadMember', () => {
    it('should remove thread member successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await removeThreadMember(botToken, threadId, 'user-123');

      expect(global.fetch).toHaveBeenCalledWith(
        `https://discord.com/api/v10/channels/${threadId}/thread-members/user-123`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle 404 when user not in thread', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'User not in thread',
      });

      await expect(removeThreadMember(botToken, threadId, 'user-123')).resolves.not.toThrow();
    });

    it('should handle 204 status as success', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(removeThreadMember(botToken, threadId, 'user-123')).resolves.not.toThrow();
    });
  });
});
