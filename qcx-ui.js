// qcx-ui.js

(function () {
  "use strict";

  const {
    createQcxFromFiles,
    openQcxFile,
    saveUint8AsFile,
    formatSize
  } = window.QCX;

  // util log khusus UI
  function log(el, msg, append = true) {
    if (!el) return;
    if (append) el.textContent += "\n" + msg;
    else el.textContent = msg;
  }

  // ========== UI: SINGLE MODE ==========

  const singleInput = document.getElementById("singleInput");
  const singlePassword = document.getElementById("singlePassword");
  const btnSingleCompress = document.getElementById("btnSingleCompress");
  const btnSingleDecompress = document.getElementById("btnSingleDecompress");
  const logSingle = document.getElementById("log");

  if (btnSingleCompress) {
    btnSingleCompress.addEventListener("click", async () => {
      const file = singleInput.files && singleInput.files[0];
      if (!file) {
        alert("Pilih file dulu untuk dikompres.");
        return;
      }
      const pwd = singlePassword.value || "";
      if (pwd.length < 6) {
        alert("Password minimal 6 karakter.");
        return;
      }

      try {
        log(logSingle, "Membuat QCX untuk 1 file: " + file.name, false);
        const { qcx, innerHeader, ratio } = await createQcxFromFiles(
          [file],
          pwd,
          (m, a) => log(logSingle, m, a)
        );
        const suggested = file.name + ".qcx";
        saveUint8AsFile(qcx, suggested);
        log(logSingle, `Selesai. QCX: ${suggested}`, true);
        log(logSingle, `Total ukuran asli: ${formatSize(innerHeader.totalSize)}`, true);
        log(logSingle, `Rasio kompresi: ${ratio.toFixed(1)}%`, true);
      } catch (err) {
        console.error(err);
        log(logSingle, "ERROR: " + err.message, true);
        alert("Gagal membuat QCX: " + err.message);
      }
    });
  }

  if (btnSingleDecompress) {
    btnSingleDecompress.addEventListener("click", async () => {
      const file = singleInput.files && singleInput.files[0];
      if (!file) {
        alert("Pilih file .qcx yang akan diekstrak.");
        return;
      }
      const pwd = singlePassword.value || "";
      if (!pwd) {
        alert("Masukkan password QCX.");
        return;
      }

      try {
        log(logSingle, "Membuka QCX single/multi...", false);
        const { innerHeader, dataConcat } = await openQcxFile(
          file,
          pwd,
          (m, a) => log(logSingle, m, a)
        );

        if (innerHeader.fileCount === 1) {
          const f = innerHeader.files[0];
          const slice = dataConcat.slice(f.offset, f.offset + f.length);
          const safeName = f.path.replace(/[/\\]+/g, "_");
          saveUint8AsFile(slice, safeName);
          log(logSingle, "Diekstrak: " + f.path, true);
        } else {
          log(
            logSingle,
            "Arsip ini berisi banyak file. Gunakan panel kanan (Mode Multi) untuk melihat dan ekstrak.",
            true
          );
          alert("QCX ini berisi banyak file. Buka di panel 'Mode Multi File / Folder'.");
        }
      } catch (err) {
        console.error(err);
        log(logSingle, "ERROR: " + err.message, true);
        alert("Gagal ekstrak QCX: " + err.message);
      }
    });
  }

  // ========== UI: MULTI MODE ==========

  const multiInput = document.getElementById("multiInput");
  const multiPassword = document.getElementById("multiPassword");
  const btnCreateMulti = document.getElementById("btnCreateMulti");
  const qcxOpenInput = document.getElementById("qcxOpenInput");
  const openPassword = document.getElementById("openPassword");
  const btnOpenQcx = document.getElementById("btnOpenQcx");
  const btnExtractAll = document.getElementById("btnExtractAll");
  const logMulti = document.getElementById("logMulti");
  const tableWrap = document.getElementById("tableWrap");
  const tableBody = document.getElementById("tableBody");

  let currentInnerHeader = null;
  let currentDataConcat = null;

  if (btnCreateMulti) {
    btnCreateMulti.addEventListener("click", async () => {
      const files = Array.from(multiInput.files || []);
      if (!files.length) {
        alert("Pilih minimal satu file/folder untuk QCX multi.");
        return;
      }
      const pwd = multiPassword.value || "";
      if (pwd.length < 6) {
        alert("Password minimal 6 karakter.");
        return;
      }

      try {
        log(logMulti, `Membuat QCX multi dari ${files.length} file...`, false);
        const { qcx, innerHeader, ratio } = await createQcxFromFiles(
          files,
          pwd,
          (m, a) => log(logMulti, m, a)
        );
        const suggested = `multi-${Date.now()}.qcx`;
        saveUint8AsFile(qcx, suggested);
        log(logMulti, `QCX multi siap: ${suggested}`, true);
        log(logMulti, `Total ukuran asli: ${formatSize(innerHeader.totalSize)}`, true);
        log(logMulti, `Rasio kompresi: ${ratio.toFixed(1)}%`, true);
      } catch (err) {
        console.error(err);
        log(logMulti, "ERROR: " + err.message, true);
        alert("Gagal membuat QCX multi: " + err.message);
      }
    });
  }

  if (btnOpenQcx) {
    btnOpenQcx.addEventListener("click", async () => {
      const file = qcxOpenInput.files && qcxOpenInput.files[0];
      if (!file) {
        alert("Pilih QCX yang akan dibuka.");
        return;
      }
      const pwd = openPassword.value || "";
      if (!pwd) {
        alert("Masukkan password QCX.");
        return;
      }

      try {
        log(logMulti, "Membuka QCX...", false);
        const { innerHeader, dataConcat } = await openQcxFile(
          file,
          pwd,
          (m, a) => log(logMulti, m, a)
        );
        currentInnerHeader = innerHeader;
        currentDataConcat = dataConcat;

        log(logMulti, `QCX valid. Jumlah file: ${innerHeader.fileCount}`, true);
        log(logMulti, `Total ukuran asli: ${formatSize(innerHeader.totalSize)}`, true);

        // tampilkan isi di tabel
        tableBody.innerHTML = "";
        innerHeader.files.forEach((f, idx) => {
          const tr = document.createElement("tr");

          const tdPath = document.createElement("td");
          tdPath.className = "cell-path";
          tdPath.textContent = f.path;

          const tdSize = document.createElement("td");
          tdSize.textContent = formatSize(f.size);

          const tdCrc = document.createElement("td");
          tdCrc.textContent = f.crc32 || "";

          const tdAct = document.createElement("td");
          const btn = document.createElement("button");
          btn.textContent = "Ekstrak";
          btn.className = "btn-sec";
          btn.dataset.index = idx;
          tdAct.appendChild(btn);

          tr.appendChild(tdPath);
          tr.appendChild(tdSize);
          tr.appendChild(tdCrc);
          tr.appendChild(tdAct);
          tableBody.appendChild(tr);
        });

        tableWrap.style.display = "block";
        log(logMulti, "Klik 'Ekstrak' di baris tertentu atau 'Ekstrak Semua → Download'.", true);
      } catch (err) {
        console.error(err);
        currentInnerHeader = null;
        currentDataConcat = null;
        tableWrap.style.display = "none";
        log(logMulti, "ERROR: " + err.message, true);
        alert("Gagal membuka QCX: " + err.message);
      }
    });
  }

  // ekstrak satu file dari tabel
  if (tableBody) {
    tableBody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-index]");
      const realBtn = btn || e.target.closest("button");
      if (!realBtn || realBtn.dataset.index === undefined) return;
      const idx = parseInt(realBtn.dataset.index, 10);
      if (!currentInnerHeader || !currentDataConcat) {
        alert("Belum ada QCX yang dibuka.");
        return;
      }
      const f = currentInnerHeader.files[idx];
      const slice = currentDataConcat.slice(f.offset, f.offset + f.length);
      const safeName = f.path.replace(/[/\\]+/g, "_");
      saveUint8AsFile(slice, safeName);
      log(logMulti, "Diekstrak: " + f.path, true);
    });
  }

  // ekstrak semua → auto download ke Downloads
  if (btnExtractAll) {
    btnExtractAll.addEventListener("click", () => {
      if (!currentInnerHeader || !currentDataConcat) {
        alert("Buka QCX dulu (dengan password yang benar).");
        return;
      }
      const hdr = currentInnerHeader;
      const data = currentDataConcat;
      log(logMulti, "Ekstrak semua file (auto-download)...", true);

      hdr.files.forEach(f => {
        const slice = data.slice(f.offset, f.offset + f.length);
        const safeName = f.path.replace(/[/\\]+/g, "_");
        saveUint8AsFile(slice, safeName);
      });

      log(logMulti, "Selesai. Semua file sudah di-download (nama file menyimpan path asal).", true);
    });
  }

})();
