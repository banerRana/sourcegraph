#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"/../../..

function checksum_client_code {
  tmpfile=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm \"$tmpfile\"" EXIT

  {
    find "./client" "./ui" "yarn.lock" -type f -exec sha1sum {} \;
    find . -maxdepth 1 -type f -name "*.js" -exec sha1sum {} \;
    find . -maxdepth 1 -type f -name "*.ts" -exec sha1sum {} \;
    find . -maxdepth 1 -type f -name "*.json" -exec sha1sum {} \;
  }>> "$tmpfile"

  # We know for sure that renovate has nothing to do with the client files.
  grep -v "renovate.json" <"$tmpfile" | sort -k 2 | sha1sum | awk '{print $1}'
}

echo "--- (enterprise) pre-build frontend"

if [[ ! "$BUILDKITE" == "true" ]]; then
  # Not-in-buildkite simple install.
  ./enterprise/cmd/frontend/pre-build.sh
else
  # set the buildkite cache access keys
  AWS_CONFIG_DIR_PATH="/buildkite/.aws"
  mkdir -p "$AWS_CONFIG_DIR_PATH"
  AWS_CONFIG_FILE="$AWS_CONFIG_DIR_PATH/config"
  export AWS_CONFIG_FILE
  AWS_SHARED_CREDENTIALS_FILE="/buildkite/.aws/credentials"
  export AWS_SHARED_CREDENTIALS_FILE
  aws configure set aws_access_key_id "$BUILDKITE_HMAC_KEY" --profile buildkite
  aws configure set aws_secret_access_key "$BUILDKITE_HMAC_SECRET" --profile buildkite

  # scan and concat all the sha1sums of the files into a single blob which is then sha1sum'd again to give us our checksum
  checksum=$(checksum_client_code)
  cache_file="cache-client-bundle-$checksum.tar.gz"
  cache_key="$BUILDKITE_ORGANIZATION_SLUG/$BUILDKITE_PIPELINE_NAME/$cache_file"

  echo -e "ClientBundle 🔍 Locating cache: $cache_key"
  if aws s3api head-object --bucket "sourcegraph_buildkite_cache" --profile buildkite --endpoint-url 'https://storage.googleapis.com' --region "us-central1" --key "$cache_key"; then
    echo -e "ClientBundle 🔥 Cache hit: $cache_key"
    aws s3 cp --profile buildkite --endpoint-url 'https://storage.googleapis.com' --region "us-central1" "s3://sourcegraph_buildkite_cache/$cache_key" "./"
    bsdtar xzf "$cache_file"
    rm "$cache_file"
  else
    echo -e "ClientBundle 🚨 Cache miss: $cache_key"
    echo "~~~ Building client from scratch"
    ./enterprise/cmd/frontend/pre-build.sh
    echo "~~~ Cache build client installation"
    bsdtar cfz "$cache_file" ./ui
    aws s3 cp --profile buildkite --endpoint-url 'https://storage.googleapis.com' --region "us-central1" "$cache_file" "s3://sourcegraph_buildkite_cache/$cache_key"
    rm "$cache_file"
  fi
fi
