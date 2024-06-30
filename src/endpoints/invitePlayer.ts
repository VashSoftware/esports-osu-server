import { BanchoClient, BanchoMultiplayerChannel } from "bancho.js";
export async function invitePlayer(
  playerOsuId: string,
  channelId: string,
  banchoClient: BanchoClient
) {
  const channel = banchoClient.getChannel(
    channelId
  ) as BanchoMultiplayerChannel;

  await channel.lobby.invitePlayer(playerOsuId);

  console.log(`Invited player ${playerOsuId} to channel ${channelId}`);
}
