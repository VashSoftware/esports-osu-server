export async function playerLeft() {
  channel.lobby.on("playerLeft", async (user) => {
    console.log(`${user.user.username} left the lobby`);

    await changeStateByUsername(user.user.id, 2);
  });
}
