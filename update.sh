#!/bin/sh
cd ../svelte-pwa
npm run build
npm run github
cd ../test
git add .
git commit -m '.'
git push
