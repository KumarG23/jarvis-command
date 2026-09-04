#!/usr/bin/env bash
set -euo pipefail
umask 022

if [[ $# -ne 2 ]]; then
  printf 'usage: %s <team.cloudflareaccess.com> <output-directory>\n' "$0" >&2
  exit 64
fi

team_domain=${1,,}
output_directory=$2
curl_bin=${CURL_BIN:-curl}

if [[ ! ${team_domain} =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.cloudflareaccess\.com$ ]]; then
  printf 'invalid Cloudflare Access team domain\n' >&2
  exit 65
fi

mkdir -p "${output_directory}"
chmod 0755 "${output_directory}"
download=$(mktemp "${output_directory}/.certs.download.XXXXXX")
validated=$(mktemp "${output_directory}/.certs.validated.XXXXXX")
trap 'rm -f "${download}" "${validated}"' EXIT

"${curl_bin}" \
  --fail \
  --silent \
  --show-error \
  --proto '=https' \
  --proto-redir '=https' \
  --tlsv1.2 \
  --connect-timeout 5 \
  --max-time 15 \
  --max-filesize 65536 \
  --output "${download}" \
  "https://${team_domain}/cdn-cgi/access/certs"

python3 - "${download}" "${validated}" "${OPENSSL_BIN:-/usr/bin/openssl}" <<'PY'
import base64
import binascii
import json
import os
import re
import subprocess
import sys

source, destination, openssl_bin = sys.argv[1:]
if os.path.getsize(source) < 1 or os.path.getsize(source) > 65_536:
    raise SystemExit('JWKS payload size is invalid')


def reject_non_json_constant(value):
    raise ValueError(f'non-JSON constant: {value}')


try:
    with open(source, encoding='utf-8') as handle:
        payload = json.load(handle, parse_constant=reject_non_json_constant)
except (json.JSONDecodeError, UnicodeError, ValueError):
    raise SystemExit('JWKS is not strict RFC 8259 JSON') from None

keys = payload.get('keys') if isinstance(payload, dict) else None
if not isinstance(keys, list) or not 1 <= len(keys) <= 16:
    raise SystemExit('JWKS must contain between 1 and 16 keys')


def decode_base64url_uint(value, label):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise SystemExit(f'JWKS key has an invalid RSA {label}')
    try:
        decoded = base64.b64decode(
            value + ('=' * (-len(value) % 4)),
            altchars=b'-_',
            validate=True,
        )
    except (binascii.Error, ValueError):
        raise SystemExit(f'JWKS key has an invalid RSA {label}') from None
    if not decoded or (len(decoded) > 1 and decoded[0] == 0):
        raise SystemExit(f'JWKS key has a non-canonical RSA {label}')
    canonical = base64.urlsafe_b64encode(decoded).rstrip(b'=').decode('ascii')
    if canonical != value:
        raise SystemExit(f'JWKS key has a non-canonical RSA {label}')
    return int.from_bytes(decoded, 'big')


def der_length(length):
    if length < 128:
        return bytes([length])
    encoded = length.to_bytes((length.bit_length() + 7) // 8, 'big')
    return bytes([0x80 | len(encoded)]) + encoded


def der_value(tag, content):
    return bytes([tag]) + der_length(len(content)) + content


def der_integer(value):
    encoded = value.to_bytes((value.bit_length() + 7) // 8, 'big')
    if encoded[0] & 0x80:
        encoded = b'\x00' + encoded
    return der_value(0x02, encoded)


def subject_public_key_info(modulus, exponent):
    rsa_public_key = der_value(0x30, der_integer(modulus) + der_integer(exponent))
    rsa_encryption_algorithm = bytes.fromhex('300d06092a864886f70d0101010500')
    return der_value(
        0x30,
        rsa_encryption_algorithm + der_value(0x03, b'\x00' + rsa_public_key),
    )


def require_crypto_import(modulus, exponent):
    try:
        result = subprocess.run(
            [openssl_bin, 'pkey', '-pubin', '-inform', 'DER', '-noout', '-check'],
            input=subject_public_key_info(modulus, exponent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        raise SystemExit('JWKS RSA public-key import failed') from None
    if result.returncode != 0:
        raise SystemExit('JWKS RSA public-key import failed')


seen_kids = set()
private_parameters = {'d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'}
for key in keys:
    if not isinstance(key, dict):
        raise SystemExit('JWKS keys must be objects')
    kid = key.get('kid')
    if (
        key.get('kty') != 'RSA'
        or key.get('alg') != 'RS256'
        or key.get('use') != 'sig'
        or not isinstance(kid, str)
        or not kid
        or len(kid) > 512
        or kid != kid.strip()
    ):
        raise SystemExit('JWKS contains a non-RS256 signing key')
    if kid in seen_kids:
        raise SystemExit('JWKS contains duplicate key IDs')
    seen_kids.add(kid)
    if private_parameters.intersection(key):
        raise SystemExit('JWKS must not contain private RSA parameters')

    key_ops = key.get('key_ops')
    if key_ops is not None and key_ops != ['verify']:
        raise SystemExit('JWKS key operations do not permit verification only')
    if 'ext' in key and key['ext'] is not True:
        raise SystemExit('JWKS key is not explicitly extractable')

    modulus = decode_base64url_uint(key.get('n'), 'modulus')
    exponent = decode_base64url_uint(key.get('e'), 'exponent')
    if not 2048 <= modulus.bit_length() <= 8192 or modulus % 2 == 0:
        raise SystemExit('JWKS RSA modulus size or parity is invalid')
    if not 3 <= exponent <= 0xFFFFFFFF or exponent % 2 == 0:
        raise SystemExit('JWKS RSA exponent is invalid')
    require_crypto_import(modulus, exponent)

with open(destination, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, separators=(',', ':'), allow_nan=False)
    handle.write('\n')
PY

chmod 0644 "${validated}"
mv -f "${validated}" "${output_directory}/certs.json"
