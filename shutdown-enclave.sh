#!/bin/bash

# FIXME check if there's running enclave

# this is a signal to parent process
>./instance/shutdown

echo "Sent shutdown signal"

# FIXME wait until describe-enclave shows no entries