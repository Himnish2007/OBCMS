// ============================================================================
// DSC (DIGITAL SIGNATURE CERTIFICATE) AUTHENTICATION
// MDTS:44415 Part A pt.vii / Part B miscellaneous: "Multifactor authentication
// methods like combinations of password, OTP, security questions, and Digital
// Signature Certificate (DSC) should be used to protect critical access and control."
//
// This is real X.509/PKI challenge-response verification, the same pattern used by
// Indian government portals (GST, e-Tendering, IREPS) for DSC login:
//
//   1. Admin uploads the user's DSC public certificate (PEM, from their existing
//      USB token / eToken — issued by a licensed CA) via Admin > Users > DSC Certificate.
//   2. At login (after password + OTP, if enabled), the server issues a random nonce
//      (POST /api/auth/dsc-challenge) and stores its hash against the user.
//   3. The user's own DSC token software (e.g. their CA's signer utility, or a
//      browser-based signer applet — same as e-Tendering sites) signs that nonce with
//      their PRIVATE key, which never leaves their token/machine.
//   4. The signature is posted back (POST /api/auth/dsc-verify) and verified here with
//      crypto.verify() against the stored PUBLIC certificate — no private key material
//      ever touches this server.
//
// What this server genuinely cannot do (and no server legitimately should): perform the
// actual signing operation, since that requires the user's private key + a specific DSC
// vendor's token driver (eToken, Watchdata, ePass, etc.). That signing step happens on
// the user's machine with whatever signer utility their DSC vendor provides — exactly
// like existing IR/RDSO web portals. This module only does the verification half.
// ============================================================================

const crypto = require("crypto");

const CHALLENGE_VALID_MINUTES = 5;

function generateChallenge() {
  return crypto.randomBytes(32).toString("hex");
}

// certPem: X.509 certificate in PEM format (as uploaded by Admin for this user)
// signatureBase64: signature over the raw challenge string, produced by the user's DSC token
function verifySignature(certPem, challenge, signatureBase64) {
  try {
    const publicKey = new crypto.X509Certificate(certPem).publicKey;
    const signature = Buffer.from(signatureBase64, "base64");
    // SHA-256 is the near-universal default for Indian Class-2/Class-3 DSC tokens (PKCS#1 v1.5
    // or RSA-PSS depending on vendor); if a specific CA's token uses a different padding/hash,
    // that's a one-line change here once Himnish knows which DSC vendor Railways requires.
    return crypto.verify("sha256", Buffer.from(challenge, "utf8"), publicKey, signature);
  } catch (err) {
    return false;
  }
}

function validateCertPem(certPem) {
  try {
    const cert = new crypto.X509Certificate(certPem);
    const now = new Date();
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      return { valid: false, error: "Certificate is expired or not yet valid." };
    }
    return { valid: true, subject: cert.subject, validTo: cert.validTo };
  } catch (err) {
    return { valid: false, error: "Not a valid X.509 PEM certificate: " + err.message };
  }
}

module.exports = { generateChallenge, verifySignature, validateCertPem, CHALLENGE_VALID_MINUTES };
