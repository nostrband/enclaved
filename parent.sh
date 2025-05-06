#!/bin/bash

runuser -l ec2-user -- -c "cd /home/ec2-user/enclaved; ./node_modules/.bin/tsx src/index.ts parent run 2080" 

