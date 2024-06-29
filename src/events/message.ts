export async function message() {
  channel.on("message", async (message) => {
    if (message.message.startsWith("close")) {
      await channel.lobby.closeLobby();

      await changeAllPlayersState(1);

      process.exit();
    }
  });
}
