import { BanchoClient } from "bancho.js";
export async function sendMessages(
  messages: string[],
  channelId: string,
  banchoClient: BanchoClient
) {
  const channel = banchoClient.getChannel(channelId);

  for (const message of messages) {
    console.log(`Sending message to channel ${channelId}: ${message}`);
    await channel.sendMessage(message);
  }
}
