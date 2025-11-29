// qcx-core.js

(function (global) {
  "use strict";

  // ========== UTIL ==========

  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
      }
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function toHex(u8) {
    return Array.from(u8).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function fromHex(str) {
    if (str.length % 2 !== 0) throw new Error("Hex length invalid");
    const out = new Uint8Array(str.length / 2);
    for (let i = 0; i < str.length; i += 2) {
      out[i / 2] = parseInt(str.slice(i, i + 2), 16);
    }
    return out;
  }

  function saveUint8AsFile(u8, name) {
    const blob = new Blob([u8]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ========== CRYPTO: PBKDF2 + AES-GCM ==========

  async function deriveKey(password, salt, iterations = 200000) {
    const enc = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey("raw", enc, "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return key;
  }

  async function aesEncrypt(key, iv, dataUint8) {
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataUint8);
    return new Uint8Array(ct);
  }

  async function aesDecrypt(key, iv, dataUint8) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, dataUint8);
    return new Uint8Array(pt);
  }

  // ========== QCX v3 CORE (BUAT ARSIP) ==========

  /**
   * @param {File[]} files
   * @param {string} password
   * @param {(msg: string, append: boolean) => void} [logFn]
   */
  async function createQcxFromFiles(files, password, logFn) {
    if (!files || files.length === 0) throw new Error("Tidak ada file.");

    // 1) Baca semua file → buffer & metadata
    const fileObjs = [];
    let totalOrig = 0;
    for (const f of files) {
      const path = f.webkitRelativePath || f.name;
      const mime = f.type || "application/octet-stream";
      const buf = new Uint8Array(await f.arrayBuffer());
      const size = buf.length;
      const crc = crc32(buf);
      totalOrig += size;
      fileObjs.push({ path, mime, buf, size, crc });
      if (logFn) logFn(`+ ${path} (${formatSize(size)})`, true);
    }

    // 2) Dedup: file dengan (size+crc+isi) sama disimpan sekali
    if (logFn) logFn("Mendeteksi file duplikat (dedup)...", true);
    const uniqueMap = new Map(); // keyBase -> { buf, offset }
    const filesMeta = [];
    let uniqueTotalSize = 0;

    for (const fo of fileObjs) {
      const keyBase = fo.size + "_" + fo.crc.toString(16);
      let entry = uniqueMap.get(keyBase);

      if (entry) {
        // cek isi bener-bener sama
        const ubuf = entry.buf;
        if (ubuf.length === fo.buf.length && ubuf.every((v, i) => v === fo.buf[i])) {
          filesMeta.push({
            path: fo.path,
            offset: entry.offset,
            length: fo.size,
            size: fo.size,
            mime: fo.mime,
            crc32: fo.crc.toString(16)
          });
          continue;
        }
        // kalau berbeda isi tapi size+crc sama (sangat jarang),
        // kita treat sebagai unik baru dengan key tambahan
        const altKey = keyBase + "_u" + uniqueTotalSize;
        entry = {
          buf: fo.buf,
          offset: uniqueTotalSize
        };
        uniqueMap.set(altKey, entry);
        filesMeta.push({
          path: fo.path,
          offset: entry.offset,
          length: fo.size,
          size: fo.size,
          mime: fo.mime,
          crc32: fo.crc.toString(16)
        });
        uniqueTotalSize += fo.size;
        continue;
      }

      // unique baru
      entry = {
        buf: fo.buf,
        offset: uniqueTotalSize
      };
      uniqueMap.set(keyBase, entry);
      filesMeta.push({
        path: fo.path,
        offset: entry.offset,
        length: fo.size,
        size: fo.size,
        mime: fo.mime,
        crc32: fo.crc.toString(16)
      });
      uniqueTotalSize += fo.size;
    }

    if (logFn) {
      logFn(`Ukuran gabungan unik setelah dedup: ${formatSize(uniqueTotalSize)}`, true);
    }

    // 3) Gabungkan data unik
    const dataConcat = new Uint8Array(uniqueTotalSize);
    for (const entry of uniqueMap.values()) {
      dataConcat.set(entry.buf, entry.offset);
    }

    // 4) innerHeader
    const innerHeader = {
      fileCount: filesMeta.length,
      totalSize: totalOrig,
      uniqueSize: uniqueTotalSize,
      files: filesMeta,
      createdAt: Date.now()
    };
    const innerHeaderBytes = new TextEncoder().encode(JSON.stringify(innerHeader));
    const innerHeaderLen = innerHeaderBytes.length;

    // 5) innerRaw = [4 byte len][header][dataConcat]
    const innerRaw = new Uint8Array(4 + innerHeaderLen + dataConcat.length);
    const dvInner = new DataView(innerRaw.buffer);
    dvInner.setUint32(0, innerHeaderLen, true);
    innerRaw.set(innerHeaderBytes, 4);
    innerRaw.set(dataConcat, 4 + innerHeaderLen);

    if (logFn) logFn("Kompresi inner payload dengan zlib (DEFLATE)...", true);
    const compressed = fflate.zlibSync(innerRaw, { level: 9 });

    // 6) Enkripsi AES-GCM
    if (logFn) logFn("Menyiapkan key AES-256-GCM via PBKDF2...", true);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = 200000;
    const key = await deriveKey(password, salt, iterations);

    if (logFn) logFn("Mengenkripsi payload terkompres...", true);
    const ciphertext = await aesEncrypt(key, iv, compressed);

    // 7) Outer header (tidak dienkripsi)
    const outerHeader = {
      magic: "QCX3",
      version: 3,
      kdf: {
        algo: "PBKDF2",
        hash: "SHA-256",
        iter: iterations,
        saltHex: toHex(salt)
      },
      cipher: {
        algo: "AES-GCM",
        ivHex: toHex(iv)
      },
      meta: {
        fileCount: innerHeader.fileCount,
        totalSize: innerHeader.totalSize,
        note: "QCX v3 universal encrypted archive"
      }
    };
    const outerHeaderBytes = new TextEncoder().encode(JSON.stringify(outerHeader));
    const outerHeaderLen = outerHeaderBytes.length;

    // 8) QCX final: [4 byte headerLen][outerHeaderJSON][ciphertext]
    const out = new Uint8Array(4 + outerHeaderLen + ciphertext.length);
    const dvOuter = new DataView(out.buffer);
    dvOuter.setUint32(0, outerHeaderLen, true);
    out.set(outerHeaderBytes, 4);
    out.set(ciphertext, 4 + outerHeaderLen);

    const ratio = 100 * (1 - out.length / innerHeader.totalSize);
    return { qcx: out, innerHeader, ratio };
  }

  // ========== QCX v3 CORE (BUKA / DECRYPT) ==========

  async function openQcxFile(file, password, logFn) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length < 8) throw new Error("File terlalu kecil, bukan QCX valid.");

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const outerHeaderLen = dv.getUint32(0, true);
    if (outerHeaderLen <= 0 || outerHeaderLen > buf.length - 4) {
      throw new Error("Outer header length tidak valid.");
    }

    const outerHeaderBytes = buf.slice(4, 4 + outerHeaderLen);
    const outerHeaderText = new TextDecoder().decode(outerHeaderBytes);
    const outerHeader = JSON.parse(outerHeaderText);

    if (outerHeader.magic !== "QCX3" || outerHeader.version !== 3) {
      throw new Error("Magic/versi QCX tidak cocok (bukan QCX3).");
    }

    const ciphertext = buf.slice(4 + outerHeaderLen);

    if (logFn) logFn("Derivasi key dari password...", true);
    const salt = fromHex(outerHeader.kdf.saltHex);
    const iv = fromHex(outerHeader.cipher.ivHex);
    const key = await deriveKey(password, salt, outerHeader.kdf.iter);

    if (logFn) logFn("Mendekripsi AES-GCM...", true);
    let compressed;
    try {
      compressed = await aesDecrypt(key, iv, ciphertext);
    } catch (e) {
      throw new Error("Password salah atau data QCX rusak (dekripsi gagal).");
    }

    if (logFn) logFn("Membuka kompresi zlib...", true);
    const innerRaw = fflate.unzlibSync(compressed);

    const dvInner = new DataView(innerRaw.buffer, innerRaw.byteOffset, innerRaw.byteLength);
    const innerHeaderLen = dvInner.getUint32(0, true);
    if (innerHeaderLen <= 0 || innerHeaderLen > innerRaw.length - 4) {
      throw new Error("Inner header length tidak valid.");
    }

    const innerHeaderBytes = innerRaw.slice(4, 4 + innerHeaderLen);
    const innerHeaderText = new TextDecoder().decode(innerHeaderBytes);
    const innerHeader = JSON.parse(innerHeaderText);
    const dataConcat = innerRaw.slice(4 + innerHeaderLen);

    return { outerHeader, innerHeader, dataConcat };
  }

  // Expose ke global
  global.QCX = {
    crc32,
    formatSize,
    toHex,
    fromHex,
    saveUint8AsFile,
    deriveKey,
    aesEncrypt,
    aesDecrypt,
    createQcxFromFiles,
    openQcxFile
  };

})(window);
