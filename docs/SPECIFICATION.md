# QCX v3 Technical Specification

**Creator: Gede Dylan Pratama Wijaya**

## File Format Specification

### Outer Header Structure
```json
{
  "magic": "QCX3",
  "version": 3,
  "kdf": {
    "algo": "PBKDF2",
    "hash": "SHA-256",
    "iter": 200000,
    "saltHex": "hex_string"
  },
  "cipher": {
    "algo": "AES-GCM", 
    "ivHex": "hex_string"
  },
  "meta": {
    "fileCount": 5,
    "totalSize": 1048576,
    "note": "QCX v3 universal encrypted archive"
  }
}
