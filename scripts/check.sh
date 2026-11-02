#!/bin/sh
# Everything a change must pass, against a debug build of the C SDK with its test hooks.
set -eu
cd "$(dirname "$0")/.."

# Built as a dylib only here, in a folder of its own: beside libvaulty.a it would turn every
# `-lvaulty` link, such as the Mac app's, into a dynamic one.
export CARGO_TARGET_DIR="$PWD/../sdk-c/target/dylib"
cargo rustc --quiet --lib --crate-type cdylib --features test-hooks --manifest-path ../sdk-c/Cargo.toml
cargo build --quiet --bin lvd --features test-hooks --manifest-path ../libvault/Cargo.toml

bun install --frozen-lockfile
bunx tsc --noEmit -p .
export LV_DAEMON="$CARGO_TARGET_DIR/debug/lvd"
LV_FAST_KDF=1 bun test test/vault.test.ts
bun test test/thread.test.ts
