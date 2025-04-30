#!/bin/bash

# Copy kernel blobs of nitro_cli, compiled by build-kernels.sh,
# to a proper dir so that nitro_cli could use them to build and launch enclaves.

DT=`date +%F_%H-%M-%S`
echo $DT
sudo mkdir -p  /usr/share/nitro_enclaves/blobs
sudo mkdir -p /usr/share/nitro_enclaves/blobs-$DT
echo "Making backup to /usr/share/nitro_enclaves/blobs-$DT"
sudo rsync -av /usr/share/nitro_enclaves/blobs/* /usr/share/nitro_enclaves/blobs-$DT/
echo "Copying new kernel blobs"
sudo rsync -av build/kernels/* /usr/share/nitro_enclaves/blobs/
echo "Done"