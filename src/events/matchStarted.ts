export async function matchStarted() {
  channel.lobby.on("playing", async () => {
    console.log("Match is now playing");

    await changeAllPlayersState(5);
  });
}
