/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/sj_registry_program.json`.
 */
export type SjRegistryProgram = {
  "address": "89J9VYahkHYZhjZpJhAMJ3Aropy7yBMBoX22UGYCQBQd",
  "metadata": {
    "name": "sjRegistryProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Sovereign Jedi Registry Program"
  },
  "instructions": [
    {
      "name": "appendManifest",
      "discriminator": [
        212,
        148,
        34,
        70,
        1,
        252,
        58,
        30
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  83,
                  74,
                  95,
                  82,
                  69,
                  71,
                  73,
                  83,
                  84,
                  82,
                  89,
                  95,
                  86,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "arg",
                "path": "vaultIdHash"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "signer": true,
          "relations": [
            "registry"
          ]
        }
      ],
      "args": [
        {
          "name": "vaultIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "manifestCid",
          "type": "string"
        },
        {
          "name": "manifestSchemaVersion",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initRegistry",
      "discriminator": [
        131,
        22,
        4,
        103,
        24,
        94,
        163,
        239
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  83,
                  74,
                  95,
                  82,
                  69,
                  71,
                  73,
                  83,
                  84,
                  82,
                  89,
                  95,
                  86,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "arg",
                "path": "vaultIdHash"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vaultId",
          "type": "string"
        },
        {
          "name": "vaultIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "manifestSchemaVersion",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "registryAccount",
      "discriminator": [
        113,
        93,
        106,
        201,
        100,
        166,
        146,
        98
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "registryFull",
      "msg": "Registry is full (max 32 entries)."
    },
    {
      "code": 6001,
      "name": "invalidSchemaVersion",
      "msg": "Invalid manifest schema version."
    },
    {
      "code": 6002,
      "name": "duplicateEntry",
      "msg": "Manifest CID already published."
    },
    {
      "code": 6003,
      "name": "invalidVaultIdHash",
      "msg": "Vault ID hash mismatch."
    },
    {
      "code": 6004,
      "name": "invalidVaultIdFormat",
      "msg": "Invalid Vault ID format (must be alpha-numeric)."
    },
    {
      "code": 6005,
      "name": "invalidCidFormat",
      "msg": "Invalid CID format."
    },
    {
      "code": 6006,
      "name": "cidTooLong",
      "msg": "CID is too long."
    }
  ],
  "types": [
    {
      "name": "registryAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "registryVersion",
            "type": "u8"
          },
          {
            "name": "manifestSchemaVersion",
            "type": "u8"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "string"
          },
          {
            "name": "entries",
            "type": {
              "vec": {
                "defined": {
                  "name": "registryEntry"
                }
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "registryEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "manifestCid",
            "type": "string"
          },
          {
            "name": "manifestCidHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "publishedAt",
            "type": "i64"
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "manifestSchemaVersion",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
