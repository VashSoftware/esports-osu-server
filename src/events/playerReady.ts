export async function playerReady() {
  channel.lobby.on("allPlayersReady", async () => {
    console.log("All players are ready");

    channel.lobby.startMatch();
  });
}
