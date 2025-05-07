NAME=enclaved-debug
SOURCE_DATE_EPOCH=`cat timestamp.txt` #$(git log -1 --pretty=%ct)
echo "Commit timestamp" $SOURCE_DATE_EPOCH

mkdir -p build

# debug dockerfile with a different entrypoint
grep -v ENTRYPOINT Dockerfile > Dockerfile-debug
cat >> Dockerfile-debug <<EOF
COPY ./debug*.sh .
ENTRYPOINT ["/enclaved/debug.sh"]
EOF

docker \
    run \
    -it \
    --rm \
    --privileged \
    -v .:/tmp/work \
    -w /tmp/work \
    --entrypoint buildctl-daemonless.sh \
    moby/buildkit:v0.20.1 \
    build \
    --frontend dockerfile.v0 \
    --opt platform=linux/amd64 \
    --opt build-arg:SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} \
    --opt filename=./Dockerfile-debug \
    --local dockerfile=. \
    --local context=. \
    --metadata-file=build/docker.json \
    --output type=docker,name=${NAME},dest=build/${NAME}.tar,buildinfo=false,rewrite-timestamp=true \
    --progress=plain \

#    --opt "build-context=enclaved:latest=docker-image://enclaved:latest@sha256:4e2143a8f66f063397b322a795f34ed0973c3264e3f055aa1f683388f6bfd5b5" \


