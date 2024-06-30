docker buildx build --platform linux/amd64 -t europe-docker.pkg.dev/vash-esports/osu-server/osu-server . \
docker push europe-docker.pkg.dev/vash-esports/osu-server/osu-server \
kubectl rollout restart deployment osu-server-deployment