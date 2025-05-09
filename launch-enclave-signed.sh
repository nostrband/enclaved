NAME=enclaved
DIR=./instance/
BUILD=./build/
BUILD_SIG=build.json

NPUB=$1

# exit on failure
set -e

# ensure
mkdir -p ${DIR}
mkdir -p ${DIR}/data

# save for later
echo ${NPUB} > ${DIR}/npub.txt

# copy info from build
cp ${BUILD}${BUILD_SIG} ${DIR}${BUILD_SIG}

# ensure instance signature
./node_modules/.bin/tsx src/index.ts cli ensure_instance_signature ${DIR}

# launch the instance, which will ask the parent process
# for the instance signature ensured above, if 
# cached signature is invalid (was supplied with a wrong EC2 parent 
# instance id) then enclave will terminate immediately
# and parent will print an error
nitro-cli run-enclave --cpu-count 6 --memory 8128 --enclave-cid 16 --eif-path ./build/${NAME}.eif

