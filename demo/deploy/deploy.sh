#!/bin/zsh
# One command per publishing step. Settings: deploy.conf next to this file (copy deploy.conf.example).
#   ./deploy.sh review   pack sounds + export + preview deployment (a unique https://<hash>.<project>.pages.dev) + check_static on it
#   ./deploy.sh prod     pack + export + production (https://<project>.pages.dev) + GitHub Pages mirror (if MIRROR_REPO)
#                        + check_static on production + commit/push the source to the private repo (if SOURCE_REPO)
#   EH_UPTO=<roomId> ./deploy.sh prod   ship rooms only up to that room (or set UPTO in deploy.conf)
# Exit status: 0 only if the export and the check on the deployed URL passed. The source backup runs even when the check fails
# (the site is already live; the backup is what lets you fix it).
set -e
HERE=${0:A:h}; APP=$HERE/../app; PROJ=${HERE:h}
[[ -f $HERE/deploy.conf ]] || { echo "deploy.conf missing: cp $HERE/deploy.conf.example $HERE/deploy.conf and fill it in"; exit 64; }
source $HERE/deploy.conf
: ${CF_PROJECT:?set CF_PROJECT in deploy.conf}
SITE_URL=${SITE_URL:-https://$CF_PROJECT.pages.dev}
mode=${1:-review}
[[ $mode == review || $mode == prod ]] || { echo "usage: deploy.sh review|prod"; exit 64; }
[[ -n $UPTO && -z $EH_UPTO ]] && export EH_UPTO=$UPTO
GITC=(); [[ -n $GIT_NAME ]] && GITC+=(-c user.name=$GIT_NAME); [[ -n $GIT_EMAIL ]] && GITC+=(-c user.email=$GIT_EMAIL)
MSGX=(); [[ -n $COMMIT_TRAILER ]] && MSGX=(-m "$COMMIT_TRAILER")

# 1. pack one-shots under the shared build lock (agents build too), then export (it takes the lock itself)
mkdir -p $APP/_wip
(cd $APP && until mkdir _wip/.buildlock 2>/dev/null; do sleep 1; done && { python3 tools/pack_sfx.py >/dev/null; r=$?; rmdir _wip/.buildlock; [ $r = 0 ]; } \
  && python3 tools/export_static.py --project $CF_PROJECT --site-url $SITE_URL --out $HERE/dist)

cd $HERE
[[ -x node_modules/.bin/wrangler ]] || npm install --silent --no-fund --no-audit

check() {   # check <url> <report.json>
  (cd $APP && node tools/check_static.mjs $1 --json $2) && return 0 || return 1
}

if [[ $mode == prod ]]; then
  npx wrangler pages deploy dist --project-name $CF_PROJECT --branch main --commit-dirty=true
  if [[ -n $MIRROR_REPO ]]; then
    [[ -d mirror/.git ]] || gh repo clone $MIRROR_REPO mirror
    rsync -a --delete --exclude .git dist/ mirror/
    (cd mirror && git add -A && { git diff --cached --quiet || git $GITC commit -q -m "Update site $(date +%F)"; } && git push -q)
    echo "mirror pushed to $MIRROR_REPO; GitHub Pages rebuilds in ~1 min${MIRROR_URL:+ → check it then: (cd ../app && node tools/check_static.mjs $MIRROR_URL)}"
  fi
  sleep 5   # let the new deployment reach the edge before checking it
  ok=0; check $SITE_URL/ $HERE/check-prod.json || ok=1
  (( ok == 0 )) && echo "check_static $SITE_URL: PASS" || echo "check_static $SITE_URL: FAIL (report: deploy/check-prod.json)"
  if [[ -n $SOURCE_REPO ]]; then
    if [[ -d $PROJ/.git ]]; then
      (cd $PROJ && git add -A && { git diff --cached --quiet || git $GITC commit -q -m "Deploy $(date +%F\ %H:%M)" $MSGX; } && git push -q \
        && echo "source backed up to $SOURCE_REPO") || echo "source backup FAILED (the site is deployed)"
    else
      echo "source backup skipped: $PROJ is not a git repository (see engine/README.md, step 10)"
    fi
  fi
  exit $ok
else
  out=$(npx wrangler pages deploy dist --project-name $CF_PROJECT --branch review --commit-dirty=true 2>&1 | tee /dev/stderr)
  url=$(print -r -- $out | grep -oE "https://[a-z0-9]+\.$CF_PROJECT\.pages\.dev" | tail -1)
  [[ -n $url ]] || { echo "no preview URL in the wrangler output"; exit 1; }
  sleep 5
  ok=0; check $url/ $HERE/check-review.json || ok=1
  echo "preview: $url  check_static: $( (( ok == 0 )) && echo PASS || echo FAIL )"
  exit $ok
fi
