#!/bin/zsh
# Start a new exhibition from the kit, or bring an existing one up to the current engine.
#   engine/new_exhibit.sh <project-dir>            new project: app/ (engine + exhibit.json from the example) + deploy/ + .gitignore
#   engine/new_exhibit.sh <project-dir> --update   overwrite the ENGINE-OWNED files only (list below); content is never touched
# Engine-owned: app/index.html app/build.py app/js/core.js app/js/API.md app/tools/* app/rooms/_stub/* deploy/deploy.sh
#               deploy/deploy.conf.example deploy/package.json
# Content (yours): app/exhibit.json app/DESIGN-RULES.md app/theme.css app/favicon.svg app/rooms/<id>/* app/js/t-*.js app/js/s-*.js app/audio/* deploy/deploy.conf
set -e
KIT=${0:A:h}
[[ -n $1 ]] || { echo "usage: new_exhibit.sh <project-dir> [--update]"; exit 64; }
DST=${1:A}; UPD=$2
if [[ -e $DST/app && $UPD != --update ]]; then echo "$DST/app exists: use --update to refresh the engine files only"; exit 1; fi
mkdir -p $DST/app/js $DST/app/tools $DST/app/rooms/_stub $DST/deploy
cp $KIT/app/index.html $KIT/app/build.py $DST/app/
cp $KIT/app/js/core.js $KIT/app/js/API.md $DST/app/js/
cp $KIT/app/tools/*.(py|mjs) $DST/app/tools/
cp $KIT/app/rooms/_stub/* $DST/app/rooms/_stub/
cp $KIT/deploy/deploy.sh $KIT/deploy/deploy.conf.example $KIT/deploy/package.json $DST/deploy/
chmod +x $DST/deploy/deploy.sh
if [[ $UPD != --update ]]; then
  cp $KIT/app/exhibit.example.json $DST/app/exhibit.json
  cp $KIT/app/DESIGN-RULES.md $DST/app/DESIGN-RULES.md   # the project's own copy: adjust word counts / label rules to the topic
  [[ -e $DST/.gitignore ]] || cp $KIT/gitignore.template $DST/.gitignore
  echo "new exhibition at $DST — next: edit app/exhibit.json, add rooms/<id>/room.json + main.webp (engine/README.md)"
else
  echo "engine files refreshed in $DST (content untouched) — rebuild: (cd $DST/app && python3 build.py)"
fi
date '+%F %T' > $DST/app/.engine-version
