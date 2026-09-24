// Static throwaway RSA-2048 test keypairs for OAuth/JWT test suites.
//
// WHY STATIC: generating RSA keys at test time (jose `generateKeyPair("RS256")`)
// is CPU-bound and takes a non-deterministic amount of time — under heavy CPU
// contention a keygen inside a Vitest hook could blow the hook timeout and fail
// the suite as a false negative. Parsing a pre-generated PEM via `importPKCS8`/
// `importSPKI` is deterministic and ~1ms, so it never flakes.
//
// These keys are TEST-ONLY throwaway material with zero connection to production.
// They are excluded from the build (tsconfig.build.json omits src/__tests__) and
// never ship in the runtime image (only dist/ is copied). NOT a secret. They were
// also selected so the random PEM body trips no leak-guard token (leak-guard.test.ts).

import { importPKCS8, importSPKI } from "jose";
import type { CryptoKey } from "jose";

export interface StaticTestKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicPem: string;
  kid: string;
}

const KEY_A_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDB6AvLTgUFrtOb
4bdq7d9tymiENvq+3rFWVosb7/JwFJAD1D1OsnL6HHtzqJsVxeQxrR11HBuwFioG
QmDA89llyjCED2H2qNlHez2LXH9F/wt/HCshRNb4RICA4hFdxilk7nIFEHL16gqK
t49w2IeFj+SuoKZxo5BAUtn+z6HxCqd4yC81+U/4VGLEGwQf42eyK/yG9fzl4UYt
RRkgOJlSU2meNfAsGK6EirjLnkpIE39vuW+sVtKFTUEoPZWFjrWXHQn2i0XWQZrX
9qGjVP17mufOhBLsmLD7B3MT8XbqvBuE5YG9Jmz5JobtI8JDe3Fjx9FL57azDglP
IhZ0Bd7JAgMBAAECggEAB0+/y27fMJuAKNNmLkwsOGsWmCRXPcWO4UcKdXINmF1Q
ytwrYvbGmsNigktxbEJAfFZfPdBirjfqZhRa//DnRHfPGYOs+XcyGN2+8IIl3cFO
sSsiPd28eghh4g+O1mmHm7cuqciOKn3533N+yfithNiWp7ZbYFM/DWCHuMcif5YK
83rE+c9gr4Z9SCqY7m1gw1LiEAC7sh5DG+bpAuADC0aoE3gxNn1+0SIAThzm5B7O
vBLI6S7eDshfUGalwvz+vat/RLot90a03y8oNWpcqZwzJevnPJ+uApA8RR748ce9
pKlwimUiKm8aGzYRH2W02rLbG8B5AgTXqKzdO3PwswKBgQDkfEFCgkbejkZKP6QK
nJZNL2gk91bqLCEMxNDhF9YJt4BhCMbq55VDN6faxDElATwJcu2LLItNOA6uukN3
1gFBgdIyeAS+9O9P62lB19+gwqugAefNCJSIrae8R7m6Z3Y7rDh3zDbI08h3G/QF
d5qD0utKDbQA9GisU9lUuHbhkwKBgQDZQcq2+tR92w8Qu1A8wriQPh5KxS8MoP7/
FZxWGPUwxLmU8Q2AcLE18/gKpjc5Xy7gGSCrVeEcz5LsM2GBBONYJbRpR9mf2eEZ
m2H6pOnzNsg3OpIsYuTbolkVf4y6qAwTkUpg22emQz56fMGMDwsDYeTaZrL72D/W
0xHcccxnswKBgDPnpkudnMviNkWXv4RJnjtakaYUKkJ4U+m6rFj2OUFr1lY00Dt8
8IOcmR0xhJiLd0AOQ7hiHiMkoPFAjyMiEpb3DvE4IpveuJ7HM9opWDwE/UgUJryF
PnjuOjSjdqXJ6yoTLaDJW4iz0857Iyw6x3c66wifpEyzOTQsuCpu3VLRAoGARUEW
uItujwv0WnYLVsMPiFN03orKu7DaeD/QTRW5mykqq1LH5giGRNeXWvWvJuezjpYT
9unyT3fPsuGSFEmVmvSx9NmFgtI2Ui5Y5kgJl5D/87MFA4cmwuiWkybMmneVGeu3
lPZ7rOFEmlEIdXgaH6LmC8SvC17cwsMXr3jLGscCgYEAuF0BPBrcQt6oC0KoUkUG
A0nhw2fr3tJfeMC6eEeNexeF72OcD+Qb50E1ZeY5fUH4d1C7ka1ddob2n41G91fM
9pPojJPOcHxUsi30xBOGg7letwK9FrMO9RFJSlllOSdPmc5gBlnBNEl7OcHJwPto
OUlrcxzZfO7kIkzDn/Un0ys=
-----END PRIVATE KEY-----`;
const KEY_A_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwegLy04FBa7Tm+G3au3f
bcpohDb6vt6xVlaLG+/ycBSQA9Q9TrJy+hx7c6ibFcXkMa0ddRwbsBYqBkJgwPPZ
ZcowhA9h9qjZR3s9i1x/Rf8LfxwrIUTW+ESAgOIRXcYpZO5yBRBy9eoKirePcNiH
hY/krqCmcaOQQFLZ/s+h8QqneMgvNflP+FRixBsEH+Nnsiv8hvX85eFGLUUZIDiZ
UlNpnjXwLBiuhIq4y55KSBN/b7lvrFbShU1BKD2VhY61lx0J9otF1kGa1/aho1T9
e5rnzoQS7Jiw+wdzE/F26rwbhOWBvSZs+SaG7SPCQ3txY8fRS+e2sw4JTyIWdAXe
yQIDAQAB
-----END PUBLIC KEY-----`;
const KEY_B_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDCWxgPTODFoPyo
YMrV09AF+x0L878WriibP/IDAJcjCNxOlswpaKQNMy1LidQRqcgxyIpiGlsRvCWz
+V/6F2yfcIgjsBes8nZeLQfbREM3B0F4XM8OIggjye/QBpwEwbIYHWG5kJI9Ige/
5iXfaICpoXNba2A+QtyES3N/xPRXgwdTel0rb4lLBIxED2K2jswa0amR1IEBoqPV
3vToGbrakVbTcGAIjKEFywcRtKrI8Vu8Hr5x6LZyx6s1d0IZxzjTb9CYRYA3P2Hk
Jq6CGg8LWC5XKpb7huPHtoCc1an5R6Dgth6FmwGF5r4IH34IWzX+foftwi0tAIxr
BeUhrbBnAgMBAAECggEADgKR1G1SEpnAb/hlbRtTEB6CGuqojqwu1ZCH4IftXSNc
kvaAPXsc83qjiQg+PXVQrtrQgH8Uq4DPJiitLqwuzCHiuASpYD7GIfnH0QC1tUTH
oMzuSNi5LEmrominj7Kd8bd3sPAaXcYs0TxE5KFC2d3lukq30FhZG9kLuJBSnYnL
Qj/yA93n5cqzPMoBfROLdWEiMI/dALjtAA9NGmZXwyG9KkVJWeo+WS0g91rBUs4R
bePAcX9avkqJNyFix9Sjc2BfmRbkXgBFHo90xqYuGxRDoHT7a2pz9BHygDXEmx3n
uwv54K9Wc+GLVT9XKlWKdx1dDpvmmCr+S+PIckTUGQKBgQDplRhiycn2wW0hE3OB
+tiXPPMJH9wyEurwQLulG5ufkmA19KHsch96ZeGpHPw+zHfSrXK2nz3UgjA03cLP
9CLMyTME39MgloZ3Gr4S6QlzsEU/y/cyiZm42ZlOEk888f8MGky/pGXMQTQE1bMO
ayebutnkwFVP2b3SoMkZg1gYjQKBgQDVAjzxFPk4eE4nTAa2e6XKbr/9auli9if8
Rcco6EGwFMWXIc2SjRhlTzsQyUPYmBhqduZ4wBHnlXaH/ml8TRoKWN1Q5ynoqrwF
ZFYkxDOl4EW2Sfer/xL+SxjXmnP1F7Um3ExXGEjnXXk6YlgrKIxlluXLvq/PPkHz
6J9WFGAxwwKBgBemzS1TmWuu8knjGlMS/1NxDHrkCvvXBosFQvrY7M0fmTZdavfy
JlXScyMYmEITmh5vCaqMPUqDVDZGLi+4XL23sb7QmyQ1ma/9uTlY92gLdTecg49O
d45MGkXZfMSDDHxBPXw6PUSNZaMHsHXJS91s8htDjl/jgGEPfs1ii00RAoGAIfpH
alVkI8PdA5u2/mje21mrOmtRaz3ExxMCX94cjE/j7OWxew0StSZcT6MrNWOdkW4B
+YT51i0bSTol7XQHEVt3gi49myWQ9HM64oaBjpYlyJwn68G2b+XewpWapZ/wf5Bo
hQQUrQNWESAa3FeNfa8CXOu/85kEwDl9ISgC6C0CgYAc8T+MCUFs8IImYX+10hlM
XxnX9agT/cXMuV31jlgFkNpb2rdcS8CFGDjVt+kQxm2wIA87TmHlRDT0y569Tu08
5eCDFNFxx+EZuGyrYIXB1xHn9bTiQqCPcLRemRDcxGPCHAnrWEuRWBfnMC2kPCwH
nDt0L09loYz3/4sSoq1/jw==
-----END PRIVATE KEY-----`;
const KEY_B_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwlsYD0zgxaD8qGDK1dPQ
BfsdC/O/Fq4omz/yAwCXIwjcTpbMKWikDTMtS4nUEanIMciKYhpbEbwls/lf+hds
n3CII7AXrPJ2Xi0H20RDNwdBeFzPDiIII8nv0AacBMGyGB1huZCSPSIHv+Yl32iA
qaFzW2tgPkLchEtzf8T0V4MHU3pdK2+JSwSMRA9ito7MGtGpkdSBAaKj1d706Bm6
2pFW03BgCIyhBcsHEbSqyPFbvB6+cei2cserNXdCGcc402/QmEWANz9h5CaughoP
C1guVyqW+4bjx7aAnNWp+Ueg4LYehZsBhea+CB9+CFs1/n6H7cItLQCMawXlIa2w
ZwIDAQAB
-----END PUBLIC KEY-----`;

async function load(privPem: string, pubPem: string, kid: string): Promise<StaticTestKey> {
  return {
    privateKey: await importPKCS8(privPem, "RS256"),
    publicKey: await importSPKI(pubPem, "RS256"),
    publicPem: pubPem,
    kid,
  };
}

/** Primary test key. Pass a custom `kid` to override the default. */
export function loadTestKeyA(kid = "test-kid-1"): Promise<StaticTestKey> {
  return load(KEY_A_PRIVATE_PEM, KEY_A_PUBLIC_PEM, kid);
}

/** Second, distinct test key — for unknown-key / kid-mismatch scenarios. */
export function loadTestKeyB(kid = "test-kid-2"): Promise<StaticTestKey> {
  return load(KEY_B_PRIVATE_PEM, KEY_B_PUBLIC_PEM, kid);
}
