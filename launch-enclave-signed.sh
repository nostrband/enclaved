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
cp -R ${BUILD}release ${DIR}

# ensure instance signature
#./node_modules/.bin/tsx src/index.ts cli ensure_instance_signature ${DIR}
encli enclave ensure_instance_signature -d ${DIR}

# resources
ENCLAVE_CPUS=`grep cpu_count /etc/nitro_enclaves/allocator.yaml | awk '{print $NF}'`
ENCLAVE_RAM=`grep memory_mib /etc/nitro_enclaves/allocator.yaml | awk '{print $NF}'`

# launch the instance, which will ask the parent process
# for the instance signature ensured above, if 
# cached signature is invalid (was supplied with a wrong EC2 parent 
# instance id) then enclave will terminate immediately
# and parent will print an error
nitro-cli run-enclave --cpu-count $ENCLAVE_CPUS --memory $ENCLAVE_RAM --enclave-cid 16 --eif-path ./build/${NAME}.eif

