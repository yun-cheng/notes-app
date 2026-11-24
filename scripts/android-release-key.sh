#!/bin/zsh
# Makes the Android release key and gives it to the GitHub workflow that publishes releases, then starts a release.
# Run it yourself, once: it asks for the password, which never leaves this Mac but for GitHub's secrets.
set -euo pipefail

KEY=~/notes-app-release.jks
KEYTOOL="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
cd "$(dirname "$0")/.."

if [[ -e $KEY ]]; then
  echo "$KEY already exists: using it."
else
  echo "Making the release key. Pick a password, then answer the questions (any name will do)."
  "$KEYTOOL" -genkeypair -v -keystore "$KEY" -keyalg RSA -keysize 4096 -validity 10000 -alias notes-app
fi

read -rs "PASS?The key's password, once more, for GitHub: "
echo
# The key's password is the keystore's, as keytool makes it.
"$KEYTOOL" -list -keystore "$KEY" -storepass "$PASS" -alias notes-app >/dev/null || { echo "That password doesn't open $KEY."; exit 1; }

base64 -i "$KEY" | gh secret set ANDROID_KEYSTORE_BASE64
print -rn -- "$PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD
print -rn -- "$PASS" | gh secret set ANDROID_KEY_PASSWORD
gh secret set ANDROID_KEY_ALIAS --body notes-app
unset PASS

gh workflow run android-release.yml
echo "Done. The release is building: gh run list --workflow android-release.yml"
echo "Back up $KEY and its password: every update has to be signed with them."
