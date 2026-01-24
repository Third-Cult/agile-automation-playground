const DISCORD_API_BASE = 'https://discord.com/api/v10';

interface DiscordAPIResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

/**
 * Make a Discord API request
 */
async function discordRequest(
  botToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<DiscordAPIResponse> {
  const url = `${DISCORD_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
  };
}

/**
 * Send a message to a Discord channel
 */
export async function sendMessage(
  botToken: string,
  channelId: string,
  content: string
): Promise<{ id: string }> {
  const response = await discordRequest(botToken, `/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      flags: 4, // Suppress embeds
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send Discord message: ${errorText}`);
  }

  return response.json();
}

/**
 * Create a thread from a message
 */
export async function createThread(
  botToken: string,
  channelId: string,
  messageId: string,
  threadName: string
): Promise<{ id: string } | null> {
  const response = await discordRequest(
    botToken,
    `/channels/${channelId}/messages/${messageId}/threads`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: threadName,
        auto_archive_duration: 1440, // 24 hours
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create thread: ${errorText}`);
  }

  return response.json();
}

/**
 * Send a message in a thread
 * Uses flags: 4 (SUPPRESS_EMBEDS) so link previews do not appear.
 */
export async function sendThreadMessage(
  botToken: string,
  threadId: string,
  content: string
): Promise<void> {
  const response = await discordRequest(botToken, `/channels/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      flags: 4, // Suppress embeds (no link preview pop-up)
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send thread message: ${errorText}`);
  }
}

/**
 * Get a Discord message by ID
 */
export async function getMessage(
  botToken: string,
  channelId: string,
  messageId: string
): Promise<{ id: string; content: string }> {
  const response = await discordRequest(botToken, `/channels/${channelId}/messages/${messageId}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Discord message: ${errorText}`);
  }

  return response.json();
}

/**
 * Edit a Discord message
 */
export async function editMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  content: string
): Promise<void> {
  const response = await discordRequest(botToken, `/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      content,
      flags: 4, // Suppress embeds
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to edit Discord message: ${errorText}`);
  }
}

/**
 * Add a reaction to a message
 */
export async function addReaction(
  botToken: string,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  // URL encode emoji for API
  const encodedEmoji = encodeURIComponent(emoji);
  const response = await discordRequest(
    botToken,
    `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
    {
      method: 'PUT',
    }
  );

  if (!response.ok && response.status !== 204) {
    // 204 is success for reactions
    const errorText = await response.text();
    throw new Error(`Failed to add reaction: ${errorText}`);
  }
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  botToken: string,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  const encodedEmoji = encodeURIComponent(emoji);
  const response = await discordRequest(
    botToken,
    `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
    {
      method: 'DELETE',
    }
  );

  // 204 is success, 404 means reaction didn't exist (which is fine)
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to remove reaction: ${errorText}`);
  }
}

/**
 * Lock or unlock a thread
 */
export async function lockThread(
  botToken: string,
  threadId: string,
  locked: boolean
): Promise<void> {
  const response = await discordRequest(botToken, `/channels/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      locked,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to ${locked ? 'lock' : 'unlock'} thread: ${errorText}`);
  }
}

/**
 * Archive and lock a thread
 */
export async function archiveThread(botToken: string, threadId: string): Promise<void> {
  const response = await discordRequest(botToken, `/channels/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      archived: true,
      locked: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to archive thread: ${errorText}`);
  }
}

/**
 * Remove a user from a thread
 */
export async function removeThreadMember(
  botToken: string,
  threadId: string,
  userId: string
): Promise<void> {
  const response = await discordRequest(botToken, `/channels/${threadId}/thread-members/${userId}`, {
    method: 'DELETE',
  });

  // 204 is success, 404 means user wasn't in thread (which is fine)
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to remove thread member: ${errorText}`);
  }
}
