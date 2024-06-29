export async function playerJoined() {
  channel.lobby.on("playerJoined", async (user) => {
    console.log(`${user.player.user.username} joined the lobby`);

    await changeStateByUsername(user.player.user.id, 3);
  });
}
