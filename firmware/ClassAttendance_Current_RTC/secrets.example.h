#pragma once
// =====================================================================
// secrets.example.h  —  template for secrets.h (which is gitignored)
// =====================================================================
// Copy this file to `secrets.h` in the same folder and fill in the real value.
//
// H7/H8: BOOTSTRAP_SECRET must be ROTATED (the previous value was committed to
// source control and is considered compromised). Generate a fresh value:
//     openssl rand -hex 32
// and set the SAME value as the `BOOTSTRAP_SECRET` secret/environment variable
// on the Supabase project (used by the /register and /assignment-poll functions).
//
// This header is intentionally NOT committed so the live secret never enters git.
// =====================================================================

#define BOOTSTRAP_SECRET "REPLACE_WITH_NEW_32_BYTE_HEX_SECRET"
