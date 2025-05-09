#!/bin/bash

cd /enclaved
pwd
uname -a
cat /etc/*release*
date
free
df
ls -l
ls -l /
ls -l /dev/

DEBUG=true ./enclave.sh
