(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const refs = Object.fromEntries([
    "imageInput","canvasUploadBtn","canvasDropHint","fileMeta","namesInput","nameCount","fontSelect","customFontOption","fontFile","fontSize","textColor","colorText",
    "fontWeight","letterSpacing","textAlign","verticalAlign","textLineEnabled","textLineSettings","textLineColor","textLineColorText","textLineWidth","textLineGap","textLineExtendLeft","textLineExtendRight","regionX","regionY","regionW","regionH","outputType",
    "quality","qualityValue","qualityField","filePrefix","includeIndex","outputSettingsBtn","exportFolderBtn","cancelBtn","progressWrap","progressBar",
    "progressText","currentName","prevBtn","nextBtn","zoomOutBtn","zoomLevelBtn","zoomInBtn","fitViewBtn","actualSizeBtn","directZoomBtn","ctrlZoomBtn",
    "previewShell","previewStage","emptyPreview","previewViewport","previewCanvas","regionBox",
    "resolution","copyBtn","downloadBtn","gallery","galleryEmpty","galleryPrev","galleryNext","pageInfo","toast",
    "sidebarResizeHandle","textResizeHandle","guideOpenBtn","guideDialog","guideDialogClose","guideDialogDone","outputDialog","outputDialogTitle","outputDialogClose","outputDialogCancel","outputDialogConfirm",
    "presetOpenBtn","presetCount","presetDialog","presetDialogClose","presetName","presetSaveBtn","presetList","presetListCount","presetImportBtn","presetImportInput",
    "folderConnectBtn","folderImportBtn","folderImportInput","folderSyncBtn","folderSaveBtn","folderPresetStatus","folderPresetCount","folderPresetList",
    "presetCurrentImage","presetCurrentSource","presetCurrentNames","presetCurrentStyle","presetCurrentColorSwatch","presetCurrentRegion","presetCurrentLine","presetCurrentOutput","presetSaveMode","presetOverwriteNotice","presetOverwriteName","presetOverwriteCancel"
  ].map(id => [id, $(id)]));

  const state = {
    source: null,
    sourceUrl: "",
    sourceFileName: "",
    sourceFile: null,
    width: 0,
    height: 0,
    names: [],
    current: 0,
    galleryPage: 0,
    pageSize: 24,
    region: { x: .155, y: .359, w: .132, h: .017 },
    regionAutoSize: false,
    regionSizeManuallyAdjusted: false,
    fitScale: 1,
    viewScale: 1,
    zoomMode: "fit",
    fontFamily: refs.fontSelect.value,
    customFontUrl: "",
    customFontFile: null,
    sharedPreset: null,
    folderSource: null,
    folderManifest: null,
    running: false,
    cancelled: false
  };

  let toastTimer = 0;
  let drag = null;
  let pan = null;
  let resizeTimer = 0;
  let canvasDragDepth = 0;
  let textWheelTimer = 0;
  let previousLineExtendLeft = Number(refs.textLineExtendLeft.value) || 0;
  let columnResize = null;
  let columnResizeFrame = 0;
  let textRegionSyncFrame = 0;

  function notify(message, error = false) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.className = `toast show${error ? " error" : ""}`;
    toastTimer = setTimeout(() => refs.toast.className = "toast", 2800);
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function scheduleColumnRelayout() {
    cancelAnimationFrame(columnResizeFrame);
    columnResizeFrame = requestAnimationFrame(() => {
      columnResizeFrame = 0;
      if (state.source) layoutPreview();
    });
  }

  function columnLimits(type) {
    if (type === "sidebar") {
      return { min: 280, max: Math.max(280, Math.min(440, window.innerWidth - 640)), property: "--sidebar-width" };
    }
    const editorWidth = document.querySelector(".editor-row")?.clientWidth || window.innerWidth;
    return { min: 220, max: Math.max(220, Math.min(420, editorWidth - 340)), property: "--text-panel-width" };
  }

  function setColumnWidth(type, width) {
    const limits = columnLimits(type);
    const value = Math.round(clamp(width, limits.min, limits.max));
    document.documentElement.style.setProperty(limits.property, `${value}px`);
    const handle = type === "sidebar" ? refs.sidebarResizeHandle : refs.textResizeHandle;
    handle.setAttribute("aria-valuenow", String(value));
    scheduleColumnRelayout();
  }

  function resetColumnWidth(type) {
    const property = type === "sidebar" ? "--sidebar-width" : "--text-panel-width";
    document.documentElement.style.removeProperty(property);
    requestAnimationFrame(() => {
      const panel = type === "sidebar" ? document.querySelector(".sidebar-wrap") : document.querySelector(".text-entry-panel");
      const handle = type === "sidebar" ? refs.sidebarResizeHandle : refs.textResizeHandle;
      handle.setAttribute("aria-valuenow", String(Math.round(panel.getBoundingClientRect().width)));
      scheduleColumnRelayout();
    });
  }

  function bindColumnResizer(handle, type) {
    const panel = type === "sidebar" ? document.querySelector(".sidebar-wrap") : document.querySelector(".text-entry-panel");
    handle.setAttribute("aria-valuenow", String(Math.round(panel.getBoundingClientRect().width)));
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      columnResize = { type, pointerId: e.pointerId, startX: e.clientX, startWidth: panel.getBoundingClientRect().width };
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("column-resizing");
      e.preventDefault();
    });
    handle.addEventListener("pointermove", e => {
      if (!columnResize || columnResize.pointerId !== e.pointerId || columnResize.type !== type) return;
      const delta = e.clientX - columnResize.startX;
      setColumnWidth(type, columnResize.startWidth + (type === "sidebar" ? delta : -delta));
    });
    const stop = e => {
      if (!columnResize || (e.pointerId !== undefined && columnResize.pointerId !== e.pointerId)) return;
      columnResize = null;
      document.body.classList.remove("column-resizing");
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("lostpointercapture", stop);
    handle.addEventListener("dblclick", () => resetColumnWidth(type));
    handle.addEventListener("keydown", e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const direction = e.key === 'ArrowRight' ? 1 : -1;
      const current = panel.getBoundingClientRect().width;
      setColumnWidth(type, current + (type === "sidebar" ? direction : -direction) * (e.shiftKey ? 20 : 10));
    });
  }

  function currentName() { return state.names[state.current] || "示例文字"; }
  function parseNames() {
    const rawLines = refs.namesInput.value.split(/\r?\n/);
    const caretLine = refs.namesInput.value.slice(0, refs.namesInput.selectionStart ?? 0).split(/\r?\n/).length - 1;
    state.names = rawLines.map(v => v.trim()).filter(Boolean);
    // 输入哪一行，就立即预览并测量哪一行，避免批量文本中仍按旧选中项计算宽度。
    const activeText = rawLines[caretLine]?.trim();
    if (activeText) {
      const activeIndex = rawLines.slice(0, caretLine + 1).filter(v => v.trim()).length - 1;
      state.current = clamp(activeIndex, 0, Math.max(0, state.names.length - 1));
    } else {
      state.current = clamp(state.current, 0, Math.max(0, state.names.length - 1));
    }
    state.galleryPage = clamp(state.galleryPage, 0, Math.max(0, Math.ceil(state.names.length / state.pageSize) - 1));
    refs.nameCount.textContent = `${state.names.length} 条内容`;
    // 每次输入都立即恢复自动贴合并重新测量，不能依赖点击或缩放编辑框来触发。
    // 手动宽高只维持到下一次文字内容变化。
    if (state.names.length) {
      state.regionAutoSize = true;
      state.regionSizeManuallyAdjusted = false;
      fitRegionToText(activeText || currentName());
      updateRegionBox();
    }
    updateAll(false);
  }

  function scheduleTextRegionSync() {
    cancelAnimationFrame(textRegionSyncFrame);
    textRegionSyncFrame = requestAnimationFrame(() => {
      textRegionSyncFrame = 0;
      // 下一帧重新读取最终值，覆盖粘贴、中文输入法和首次输入时的时序差异。
      const lines = refs.namesInput.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (!state.source || !lines.length) return;
      state.names = lines;
      state.current = clamp(state.current, 0, lines.length - 1);
      state.regionAutoSize = true;
      state.regionSizeManuallyAdjusted = false;
      fitRegionToText(currentName());
      updateRegionBox();
      renderPreview();
      renderGallery();
    });
  }

  async function decodeImage(file) {
    if ("createImageBitmap" in window) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch (_) { /* 使用兼容方案 */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally { URL.revokeObjectURL(url); }
  }

  async function loadImage(file, quiet = false) {
    if (!file || !file.type.startsWith("image/")) return notify("请选择有效的图片文件。", true);
    try {
      const source = await decodeImage(file);
      if (state.source && typeof state.source.close === "function") state.source.close();
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      state.source = source;
      state.sourceFile = file;
      state.sourceUrl = URL.createObjectURL(file);
      state.sourceFileName = file.name.replace(/\.[^.]+$/, "");
      state.width = source.width || source.naturalWidth;
      state.height = source.height || source.naturalHeight;
      state.zoomMode = "fit";
      if (state.names.length) {
        state.regionAutoSize = true;
        state.regionSizeManuallyAdjusted = false;
        fitRegionToText();
      }
      refs.fileMeta.textContent = `${file.name} · ${state.width} × ${state.height}px · ${formatBytes(file.size)}`;
      refs.resolution.textContent = `输出尺寸：${state.width} × ${state.height}px`;
      updateAll();
      refs.canvasUploadBtn.querySelector("b").textContent = "更换底图";
      if (!quiet) notify("底图已加载，可以拖动文字区域。");
    } catch (error) {
      console.error(error);
      if (quiet) throw error;
      notify("图片读取失败，请换一张图片重试。", true);
    }
  }

  function clearImage() {
    if (state.source && typeof state.source.close === "function") state.source.close();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    state.source = null;
    state.sourceUrl = "";
    state.sourceFile = null;
    state.sourceFileName = "";
    state.width = state.height = 0;
    refs.fileMeta.textContent = "支持 PNG、JPEG、WebP";
    refs.resolution.textContent = "输出尺寸：—";
    refs.canvasUploadBtn.querySelector("b").textContent = "上传底图";
  }

  const PRESET_LIMIT = 10;
  const FOLDER_PRESET_FORMAT = "batch-image-text-tool-folder-presets";
  const FOLDER_PRESET_VERSION = 1;
  const PORTABLE_PRESET_FORMAT = "batch-image-text-tool-preset";
  const PORTABLE_PRESET_VERSION = 1;
  const SHARE_BOOTSTRAP_MARKER = "<" + "!--SHARED_PRESET_BOOTSTRAP-->";
  let presetDbPromise = null;
  let presetBusy = false;
  let presetOverwriteTarget = null;
  let presetListGeneration = 0;
  const presetThumbnailUrls = [];
  const folderThumbnailUrls = [];
  function clearPresetThumbnailUrls() {
    presetThumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    presetThumbnailUrls.length = 0;
  }

  function createThumbnailBlob(source) {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) return Promise.reject(new Error("底图尺寸无效"));
    const scale = Math.min(160 / width, 100 / height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        canvas.width = canvas.height = 1;
        if (blob) resolve(blob);
        else reject(new Error("无法生成底图缩略图"));
      }, "image/webp", .76);
    });
  }

  function showPresetThumbnail(container, blob, name, urlStore = presetThumbnailUrls) {
    const url = URL.createObjectURL(blob);
    urlStore.push(url);
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${name} 的底图缩略图`;
    image.loading = "lazy";
    container.replaceChildren(image);
  }
  function openPresetDb() {
    if (!window.indexedDB) return Promise.reject(new Error("当前浏览器不支持本地预设存储"));
    if (!presetDbPromise) {
      presetDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("batch-image-text-tool-presets", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("presets")) db.createObjectStore("presets", { keyPath: "id" });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("无法打开本地存储"));
      }).catch(error => { presetDbPromise = null; throw error; });
    }
    return presetDbPromise;
  }

  async function readPresetState() {
    const db = await openPresetDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["presets", "meta"], "readonly");
      let presets = [], defaultId = null;
      tx.objectStore("presets").getAll().onsuccess = event => { presets = event.target.result || []; };
      tx.objectStore("meta").get("defaultPresetId").onsuccess = event => { defaultId = event.target.result?.value || null; };
      tx.oncomplete = () => resolve({ presets: presets.sort((a, b) => b.savedAt - a.savedAt), defaultId });
      tx.onerror = () => reject(tx.error || new Error("读取预设失败"));
    });
  }

  function fileAsDataUrl(file) {
    if (!file) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type || "application/octet-stream", dataUrl: reader.result });
      reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
  }

  async function toPortablePreset(preset) {
    return {
      format: PORTABLE_PRESET_FORMAT,
      version: PORTABLE_PRESET_VERSION,
      name: preset.name,
      config: preset.config,
      image: await fileAsDataUrl(preset.imageFile),
      font: await fileAsDataUrl(preset.fontFile)
    };
  }

  function dataUrlAsFile(entry, kind) {
    if (entry == null) return null;
    if (!entry || typeof entry.name !== "string" || typeof entry.dataUrl !== "string") throw new Error(`${kind}文件数据不完整`);
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(entry.dataUrl);
    if (!match) throw new Error(`${kind}文件编码无效`);
    const base64 = match[2];
    const chunks = [];
    for (let offset = 0; offset < base64.length; offset += 32768) {
      const piece = atob(base64.slice(offset, offset + 32768));
      const array = new Uint8Array(piece.length);
      for (let i = 0; i < piece.length; i++) array[i] = piece.charCodeAt(i);
      chunks.push(array);
    }
    const type = match[1];
    if (kind === "底图" && !type.startsWith("image/")) throw new Error("底图格式无效");
    if (kind === "字体" && !/\.(ttf|otf|woff2?)$/i.test(entry.name)) throw new Error("字体格式无效");
    return new File(chunks, entry.name.slice(0, 180), { type });
  }

  function fromPortablePreset(portable) {
    if (!portable || portable.format !== PORTABLE_PRESET_FORMAT || portable.version !== PORTABLE_PRESET_VERSION ||
        typeof portable.name !== "string" || !portable.name.trim() || !portable.config || typeof portable.config !== "object" || Array.isArray(portable.config)) {
      throw new Error("不是受支持的预设文件");
    }
    return {
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: portable.name.trim().slice(0, 40),
      savedAt: Date.now(),
      config: portable.config,
      imageFile: dataUrlAsFile(portable.image, "底图"),
      fontFile: dataUrlAsFile(portable.font, "字体"),
      thumbnailBlob: null
    };
  }

  async function preparePortablePreset(portable) {
    const preset = fromPortablePreset(portable);
    if (preset.imageFile) {
      const source = await decodeImage(preset.imageFile);
      try { preset.thumbnailBlob = await createThumbnailBlob(source); }
      finally { source.close?.(); }
    }
    return preset;
  }

  function emptyFolderManifest() {
    return { format: FOLDER_PRESET_FORMAT, version: FOLDER_PRESET_VERSION, defaultId: null, presets: [] };
  }

  function validateFolderManifest(manifest) {
    if (!manifest || manifest.format !== FOLDER_PRESET_FORMAT || manifest.version !== FOLDER_PRESET_VERSION || !Array.isArray(manifest.presets)) {
      throw new Error("文件夹中的预设清单格式不受支持");
    }
    for (const entry of manifest.presets) {
      if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" || !entry.config || typeof entry.config !== "object") {
        throw new Error("文件夹中的预设信息不完整");
      }
      for (const asset of [entry.image, entry.font, entry.thumbnail]) {
        if (asset && (typeof asset.file !== "string" || !/^[^./\\][^/\\]*$/.test(asset.file))) {
          throw new Error("预设素材路径不安全");
        }
      }
    }
    return manifest;
  }

  async function readFolderManifest(source) {
    let file;
    if (source.kind === "handle") {
      let directory;
      try { directory = await source.handle.getDirectoryHandle("presets"); }
      catch (error) { if (error.name === "NotFoundError") return emptyFolderManifest(); throw error; }
      try { file = await (await directory.getFileHandle("manifest.json")).getFile(); }
      catch (error) { if (error.name === "NotFoundError") return emptyFolderManifest(); throw error; }
    } else {
      file = source.files.get("presets/manifest.json");
      if (!file) throw new Error("所选文件夹中没有 presets/manifest.json");
    }
    return validateFolderManifest(JSON.parse(await file.text()));
  }

  async function getFolderAsset(source, asset) {
    if (!asset) return null;
    let file;
    if (source.kind === "handle") {
      const presetsDirectory = await source.handle.getDirectoryHandle("presets");
      const assetsDirectory = await presetsDirectory.getDirectoryHandle("assets");
      file = await (await assetsDirectory.getFileHandle(asset.file)).getFile();
    } else file = source.files.get(`presets/assets/${asset.file}`);
    if (!file) throw new Error(`缺少素材：${asset.file}`);
    return file;
  }

  async function getFolderPreset(entry, source = state.folderSource) {
    const [imageBlob, fontBlob] = await Promise.all([getFolderAsset(source, entry.image), getFolderAsset(source, entry.font)]);
    const namedFile = (blob, asset) => blob && new File([blob], asset.name || blob.name, { type: blob.type || asset.type || "application/octet-stream" });
    return {
      id: entry.id, name: entry.name, savedAt: entry.savedAt, config: entry.config,
      imageFile: namedFile(imageBlob, entry.image), fontFile: namedFile(fontBlob, entry.font), thumbnailBlob: null
    };
  }

  async function writeFolderAsset(directory, file, id, kind, savedAt) {
    if (!file) return null;
    const filename = `${safeName(id)}-${savedAt}-${Math.random().toString(36).slice(2, 8)}-${kind}-${safeName(file.name).slice(0, 70)}`;
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(file); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    return { file: filename, name: file.name, type: file.type };
  }

  async function writeFolderManifest(manifest) {
    if (state.folderSource?.kind !== "handle") throw new Error("请先连接可写的工作文件夹");
    const directory = await state.folderSource.handle.getDirectoryHandle("presets", { create: true });
    const file = await directory.getFileHandle("manifest.json", { create: true });
    const writable = await file.createWritable();
    try { await writable.write(JSON.stringify(manifest, null, 2) + "\n"); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
  }

  async function saveFolderPreset(preset) {
    if (state.folderSource?.kind !== "handle") throw new Error("请先连接可写的工作文件夹");
    const manifest = await readFolderManifest(state.folderSource);
    const index = manifest.presets.findIndex(entry => entry.id === preset.id);
    const previous = index >= 0 ? manifest.presets[index] : null;
    if (index < 0 && manifest.presets.length >= PRESET_LIMIT) throw new Error("文件夹已保存 10 组预设，请先删除或覆盖一组");
    const directory = await state.folderSource.handle.getDirectoryHandle("presets", { create: true });
    const assets = await directory.getDirectoryHandle("assets", { create: true });
    const savedAt = Date.now();
    const image = await writeFolderAsset(assets, preset.imageFile, preset.id, "image", savedAt);
    const font = await writeFolderAsset(assets, preset.fontFile, preset.id, "font", savedAt);
    let thumbnailFile = preset.thumbnailBlob;
    if (!thumbnailFile && preset.imageFile) {
      const source = await decodeImage(preset.imageFile);
      try { thumbnailFile = await createThumbnailBlob(source); }
      finally { source.close?.(); }
    }
    const thumbnail = await writeFolderAsset(assets, thumbnailFile && new File([thumbnailFile], "thumbnail.webp", { type: "image/webp" }), preset.id, "thumb", savedAt);
    const entry = { id: preset.id, name: preset.name, savedAt, config: preset.config, image, font, thumbnail };
    if (index < 0) manifest.presets.unshift(entry);
    else manifest.presets[index] = entry;
    manifest.defaultId = preset.id;
    await writeFolderManifest(manifest);
    state.folderManifest = manifest;
    if (previous) {
      const stillUsed = new Set(manifest.presets.flatMap(item => [item.image?.file, item.font?.file, item.thumbnail?.file].filter(Boolean)));
      for (const asset of [previous.image, previous.font, previous.thumbnail].filter(Boolean)) {
        if (!stillUsed.has(asset.file)) await assets.removeEntry(asset.file).catch(error => console.warn("旧素材清理失败", error));
      }
    }
    await renderFolderPresetList();
  }

  async function renderFolderPresetList() {
    folderThumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    folderThumbnailUrls.length = 0;
    const list = refs.folderPresetList;
    list.replaceChildren();
    const manifest = state.folderManifest;
    refs.folderSaveBtn.disabled = state.folderSource?.kind !== "handle";
    refs.folderSyncBtn.disabled = state.folderSource?.kind !== "handle";
    refs.folderPresetCount.textContent = `${manifest?.presets.length || 0} / ${PRESET_LIMIT}`;
    refs.folderPresetStatus.textContent = state.folderSource
      ? `${state.folderSource.name} · ${state.folderSource.kind === "handle" ? "可读写" : "只读"}`
      : "尚未连接文件夹";
    if (!manifest) return;
    if (!manifest.presets.length) {
      const empty = document.createElement("div");
      empty.className = "preset-empty";
      empty.textContent = "这个工作文件夹还没有预设。连接后保存当前配置即可建立 presets/。";
      list.append(empty);
      return;
    }
    const source = state.folderSource;
    for (const entry of manifest.presets) {
      const item = document.createElement("div");
      item.className = `preset-item${entry.id === manifest.defaultId ? " is-default" : ""}`;
      const info = document.createElement("div");
      info.className = "preset-item-info";
      const thumb = document.createElement("div");
      thumb.className = "preset-thumb";
      thumb.textContent = entry.thumbnail ? "读取中" : "无底图";
      if (entry.thumbnail) getFolderAsset(source, entry.thumbnail).then(file => {
        if (state.folderSource === source && refs.presetDialog.open) showPresetThumbnail(thumb, file, entry.name, folderThumbnailUrls);
      }).catch(() => { thumb.textContent = "预览不可用"; });
      const main = document.createElement("div");
      main.className = "preset-item-main";
      const title = document.createElement("div");
      title.className = "preset-item-name";
      const name = document.createElement("strong");
      name.textContent = entry.name;
      title.append(name);
      if (entry.id === manifest.defaultId) {
        const badge = document.createElement("span");
        badge.className = "preset-default-badge";
        badge.textContent = "文件夹默认";
        title.append(badge);
      }
      const meta = document.createElement("span");
      meta.className = "preset-item-meta";
      meta.textContent = `${entry.image ? `底图 ${entry.image.name}` : "无底图"}${entry.font ? ` · 字体 ${entry.font.name}` : ""}`;
      main.append(title, meta);
      info.append(thumb, main);
      const actions = document.createElement("div");
      actions.className = "preset-item-actions";
      const button = (label, handler, className = "") => {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        if (className) control.className = className;
        control.addEventListener("click", handler);
        actions.append(control);
      };
      button("载入", async () => {
        if (presetBusy || state.running) return;
        presetBusy = true;
        try { await applyPreset(await getFolderPreset(entry, source)); refs.presetDialog.close(); }
        catch (error) { console.error(error); notify(`载入失败：${error.message}`, true); }
        finally { presetBusy = false; }
      });
      if (source.kind === "handle") {
        button("用当前配置覆盖", async () => {
          if (presetBusy || state.running || !window.confirm(`用上方当前配置覆盖文件夹预设“${entry.name}”？`)) return;
          presetBusy = true;
          try {
            const preset = { id: entry.id, name: refs.presetName.value.trim() || entry.name, config: capturePresetConfig(), imageFile: state.sourceFile, fontFile: state.customFontFile, thumbnailBlob: state.source ? await createThumbnailBlob(state.source) : null };
            await saveFolderPreset(preset);
            notify(`文件夹预设“${preset.name}”已更新。`);
          } catch (error) { console.error(error); notify(`保存失败：${error.message}`, true); }
          finally { presetBusy = false; }
        });
        if (entry.id !== manifest.defaultId) button("设为默认", async () => {
          if (presetBusy) return;
          presetBusy = true;
          try { manifest.defaultId = entry.id; await writeFolderManifest(manifest); state.folderManifest = manifest; await renderFolderPresetList(); notify(`文件夹默认预设：${entry.name}`); }
          catch (error) { console.error(error); notify(`设置失败：${error.message}`, true); }
          finally { presetBusy = false; }
        });
        button("删除", async () => {
          if (presetBusy || state.running || !window.confirm(`从工作文件夹删除预设“${entry.name}”及对应素材？此操作无法撤销。`)) return;
          presetBusy = true;
          try {
            const next = { ...manifest, presets: manifest.presets.filter(item => item.id !== entry.id) };
            if (next.defaultId === entry.id) next.defaultId = next.presets[0]?.id || null;
            await writeFolderManifest(next);
            state.folderManifest = next;
            const assetsDirectory = await (await source.handle.getDirectoryHandle("presets")).getDirectoryHandle("assets");
            for (const asset of [entry.image, entry.font, entry.thumbnail].filter(Boolean)) {
              await assetsDirectory.removeEntry(asset.file).catch(error => console.warn("素材清理失败", error));
            }
            await renderFolderPresetList();
            notify("文件夹预设已删除。");
          } catch (error) { console.error(error); notify(`删除失败：${error.message}`, true); }
          finally { presetBusy = false; }
        }, "preset-delete");
      }
      item.append(info, actions);
      list.append(item);
    }
  }

  let shareTemplatePromise = null;
  function loadShareTemplate() {
    if (window.__BATCH_IMAGE_TEXT_SHARE_TEMPLATE__) return Promise.resolve(window.__BATCH_IMAGE_TEXT_SHARE_TEMPLATE__);
    if (!shareTemplatePromise) {
      shareTemplatePromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "assets/share-template.js?v=1.3.1";
        script.onload = () => resolve(window.__BATCH_IMAGE_TEXT_SHARE_TEMPLATE__);
        script.onerror = () => reject(new Error("共享网页模板不可用"));
        document.head.append(script);
      }).catch(error => { shareTemplatePromise = null; throw error; });
    }
    return shareTemplatePromise;
  }

  function scriptSafeJson(value) { return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }

  async function exportPortablePreset(preset, asPage) {
    if (presetBusy) return;
    presetBusy = true;
    try {
      const portable = await toPortablePreset(preset);
      const filename = safeName(preset.name);
      if (asPage) {
        const template = await loadShareTemplate();
        if (typeof template !== "string" || !template.includes(SHARE_BOOTSTRAP_MARKER)) throw new Error("共享网页模板损坏");
        const bootstrap = "<" + `script>window.__BATCH_IMAGE_TEXT_SHARE_TEMPLATE__=${scriptSafeJson(template)};window.__BATCH_IMAGE_TEXT_SHARED_PRESET__=${scriptSafeJson(portable)};<\/script>`;
        const html = template.replace(SHARE_BOOTSTRAP_MARKER, bootstrap);
        triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), `${filename}-共享网页.html`);
      } else {
        triggerDownload(new Blob([JSON.stringify(portable)], { type: "application/json;charset=utf-8" }), `${filename}-预设.json`);
      }
      notify(asPage ? "共享网页已下载。接收者双击打开即可使用。" : "预设文件已下载。接收者可在配置预设中导入。");
    } catch (error) {
      console.error(error);
      notify(`导出失败：${error.message || "请重试"}`, true);
    } finally { presetBusy = false; }
  }

  async function writePreset(preset, defaultId = preset.id) {
    const db = await openPresetDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["presets", "meta"], "readwrite");
      tx.objectStore("presets").put(preset);
      tx.objectStore("meta").put({ key: "defaultPresetId", value: defaultId });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("保存预设失败"));
      tx.onabort = () => reject(tx.error || new Error("保存预设失败"));
    });
  }

  async function changeDefaultPreset(id) {
    const db = await openPresetDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ key: "defaultPresetId", value: id });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("设置默认预设失败"));
    });
  }

  async function removePreset(id, nextDefaultId) {
    const db = await openPresetDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["presets", "meta"], "readwrite");
      tx.objectStore("presets").delete(id);
      tx.objectStore("meta").put({ key: "defaultPresetId", value: nextDefaultId });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("删除预设失败"));
    });
  }

  async function updatePresetThumbnail(id, savedAt, thumbnailBlob) {
    const db = await openPresetDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("presets", "readwrite");
      const store = tx.objectStore("presets");
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result;
        if (current && current.savedAt === savedAt && current.imageFile && !current.thumbnailBlob) {
          current.thumbnailBlob = thumbnailBlob;
          store.put(current);
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("更新缩略图失败"));
    });
  }

  async function fillLegacyPresetThumbnails(pending, generation) {
    for (const { preset, container } of pending) {
      if (generation !== presetListGeneration) return;
      let source = null;
      try {
        source = await decodeImage(preset.imageFile);
        if (generation !== presetListGeneration) return;
        const thumbnailBlob = await createThumbnailBlob(source);
        if (generation !== presetListGeneration) return;
        await updatePresetThumbnail(preset.id, preset.savedAt, thumbnailBlob);
        if (generation === presetListGeneration && refs.presetDialog.open) showPresetThumbnail(container, thumbnailBlob, preset.name);
      } catch (error) {
        console.warn("旧预设缩略图生成失败", error);
        if (generation === presetListGeneration) container.textContent = "预览不可用";
      } finally {
        if (source && typeof source.close === "function") source.close();
      }
    }
  }

  function capturePresetConfig() {
    const values = {};
    ["fontSelect","fontSize","fontWeight","letterSpacing","textAlign","verticalAlign","textLineWidth","textLineGap","textLineExtendLeft","textLineExtendRight","outputType","quality","filePrefix"].forEach(id => { values[id] = refs[id].value; });
    values.textColor = refs.textColor.value;
    values.textLineColor = refs.textLineColor.value;
    values.textLineEnabled = refs.textLineEnabled.checked;
    values.includeIndex = refs.includeIndex.checked;
    values.namesInput = refs.namesInput.value;
    values.region = { ...state.region };
    values.ctrlZoomMode = ctrlZoomMode;
    values.sidebarWidth = document.documentElement.style.getPropertyValue("--sidebar-width").trim();
    values.textPanelWidth = document.documentElement.style.getPropertyValue("--text-panel-width").trim();
    return values;
  }

  function renderPresetSaveSummary() {
    const imageBox = refs.presetCurrentImage;
    imageBox.replaceChildren();
    if (state.sourceUrl) {
      const image = document.createElement("img");
      image.src = state.sourceUrl;
      image.alt = "当前底图缩略预览";
      imageBox.append(image);
    } else imageBox.textContent = "无底图";

    const setSummary = (element, value) => {
      element.textContent = value;
      element.title = value;
    };
    setSummary(refs.presetCurrentSource, state.sourceFile
      ? `${state.sourceFile.name} · ${state.width} × ${state.height}px`
      : "未选择底图（仅保存参数）");
    const lines = refs.namesInput.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const firstLine = lines[0] ? Array.from(lines[0]).slice(0, 18).join("") + (Array.from(lines[0]).length > 18 ? "…" : "") : "";
    setSummary(refs.presetCurrentNames, `${lines.length} 条${firstLine ? ` · ${firstLine}` : ""}`);
    const fontName = state.customFontFile ? `本机字体 ${state.customFontFile.name}` : (refs.fontSelect.selectedOptions[0]?.textContent || "黑体");
    const weightName = refs.fontWeight.selectedOptions[0]?.textContent || "常规";
    const color = refs.textColor.value.toUpperCase();
    refs.presetCurrentColorSwatch.style.backgroundColor = color;
    const horizontal = refs.textAlign.selectedOptions[0]?.textContent || "左对齐";
    const vertical = refs.verticalAlign.selectedOptions[0]?.textContent || "底部";
    setSummary(refs.presetCurrentStyle, `${fontName} · ${refs.fontSize.value}px · ${weightName} · ${color} · ${horizontal}/${vertical} · 字距 ${refs.letterSpacing.value}px`);
    const r = state.region;
    setSummary(refs.presetCurrentRegion, `X ${(r.x * 100).toFixed(1)}% · Y ${(r.y * 100).toFixed(1)}% · 宽 ${(r.w * 100).toFixed(1)}% · 高 ${(r.h * 100).toFixed(1)}%`);
    setSummary(refs.presetCurrentLine, refs.textLineEnabled.checked
      ? `显示 · ${refs.textLineColor.value.toUpperCase()} · ${refs.textLineWidth.value}px · 间距 ${refs.textLineGap.value}px · 左 ${refs.textLineExtendLeft.value}px / 右 ${refs.textLineExtendRight.value}px`
      : "不显示");
    const format = refs.outputType.selectedOptions[0]?.textContent || "PNG";
    const output = `${format} · ${format === "PNG" ? "质量不适用" : `质量 ${refs.quality.value}%`} · ${refs.includeIndex.checked ? "含序号" : "无序号"}${refs.filePrefix.value ? ` · 前缀 ${refs.filePrefix.value}` : ""}`;
    setSummary(refs.presetCurrentOutput, output);
  }

  function resetPresetSaveMode(clearName = true) {
    presetOverwriteTarget = null;
    refs.presetOverwriteNotice.hidden = true;
    refs.presetOverwriteName.textContent = "";
    refs.presetSaveMode.textContent = "新预设";
    refs.presetSaveBtn.textContent = "保存当前配置";
    if (clearName) refs.presetName.value = "";
  }

  function preparePresetOverwrite(preset) {
    if (presetBusy || state.running) return;
    presetOverwriteTarget = preset;
    refs.presetName.value = preset.name;
    refs.presetOverwriteName.textContent = preset.name;
    refs.presetOverwriteNotice.hidden = false;
    refs.presetSaveMode.textContent = `覆盖「${preset.name}」`;
    refs.presetSaveBtn.textContent = "确认覆盖并保存";
    refs.presetSaveBtn.disabled = false;
    renderPresetSaveSummary();
    refs.presetName.focus();
    refs.presetName.select();
  }

  async function loadCustomFont(file, quiet = false) {
    if (state.customFontUrl) URL.revokeObjectURL(state.customFontUrl);
    state.customFontUrl = URL.createObjectURL(file);
    try {
      const fontName = `UserLocalFont${Date.now()}`;
      const font = new FontFace(fontName, `url(${state.customFontUrl})`);
      await font.load();
      document.fonts.add(font);
      state.fontFamily = `"${fontName}", sans-serif`;
      state.customFontFile = file;
      refs.customFontOption.value = state.fontFamily;
      refs.customFontOption.textContent = `本机字体 · ${file.name}`;
      refs.customFontOption.hidden = false;
      refs.fontSelect.value = state.fontFamily;
      if (!quiet) notify(`已加载字体：${file.name}`);
      updateAll(false);
    } catch (error) {
      URL.revokeObjectURL(state.customFontUrl);
      state.customFontUrl = "";
      state.customFontFile = null;
      throw error;
    }
  }

  async function applyPreset(preset, quiet = false) {
    const config = preset.config || {};
    if (preset.imageFile) await loadImage(preset.imageFile, true);
    else clearImage();
    ["fontSelect","fontSize","fontWeight","letterSpacing","textAlign","verticalAlign","textLineWidth","textLineGap","textLineExtendLeft","textLineExtendRight","outputType","quality","filePrefix"].forEach(id => {
      if (config[id] !== undefined) refs[id].value = config[id];
    });
    refs.textColor.value = config.textColor || "#ecd6ab";
    refs.colorText.value = refs.textColor.value.toUpperCase();
    refs.textLineColor.value = config.textLineColor || "#ecd6ab";
    refs.textLineColorText.value = refs.textLineColor.value.toUpperCase();
    refs.textLineEnabled.checked = Boolean(config.textLineEnabled);
    refs.includeIndex.checked = Boolean(config.includeIndex);
    refs.namesInput.value = config.namesInput || "";
    state.names = refs.namesInput.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    state.current = 0;
    state.galleryPage = 0;
    refs.nameCount.textContent = `${state.names.length} 条内容`;
    const savedRegion = config.region || {};
    const x = clamp(Number(savedRegion.x) || 0, 0, .99);
    const y = clamp(Number(savedRegion.y) || 0, 0, .99);
    state.region = { x, y, w: clamp(Number(savedRegion.w) || .132, .001, 1 - x), h: clamp(Number(savedRegion.h) || .017, .001, 1 - y) };
    state.regionAutoSize = false;
    state.regionSizeManuallyAdjusted = true;
    previousLineExtendLeft = Number(refs.textLineExtendLeft.value) || 0;
    state.fontFamily = refs.fontSelect.value;
    if (preset.fontFile) await loadCustomFont(preset.fontFile, true);
    else {
      if (state.customFontUrl) URL.revokeObjectURL(state.customFontUrl);
      state.customFontUrl = "";
      state.customFontFile = null;
      refs.customFontOption.hidden = true;
    }
    ctrlZoomMode = Boolean(config.ctrlZoomMode);
    syncCtrlZoomMode();
    if (config.sidebarWidth) setColumnWidth("sidebar", parseFloat(config.sidebarWidth));
    else resetColumnWidth("sidebar");
    if (config.textPanelWidth) setColumnWidth("text", parseFloat(config.textPanelWidth));
    else resetColumnWidth("text");
    refs.textLineSettings.hidden = !refs.textLineEnabled.checked;
    [refs.textLineColor, refs.textLineColorText, refs.textLineWidth, refs.textLineGap, refs.textLineExtendLeft, refs.textLineExtendRight].forEach(control => { control.disabled = !refs.textLineEnabled.checked; });
    syncQualityControl();
    updateAll();
    if (!quiet) notify(`已载入配置：${preset.name}`);
  }

  async function refreshPresetList() {
    let presets = [], defaultId = null;
    let localAvailable = true;
    try { ({ presets, defaultId } = await readPresetState()); }
    catch (error) { localAvailable = false; console.warn("本地预设存储不可用", error); }
    const generation = ++presetListGeneration;
    clearPresetThumbnailUrls();
    refs.presetCount.textContent = `${presets.length}/${PRESET_LIMIT}`;
    refs.presetListCount.textContent = `${presets.length} / ${PRESET_LIMIT}`;
    refs.presetSaveBtn.disabled = !localAvailable || (presets.length >= PRESET_LIMIT && !presetOverwriteTarget) || presetBusy;
    refs.presetList.replaceChildren();
    if (!presets.length && !state.sharedPreset) {
      const empty = document.createElement("div");
      empty.className = "preset-empty";
      empty.textContent = localAvailable ? "还没有保存的配置。设置好画布与文字后，在上方保存第一组。" : "当前浏览器不支持本机预设存储，仍可使用下方工作文件夹预设。";
      refs.presetList.append(empty);
      return;
    }
    const legacyThumbnails = [];
    [state.sharedPreset, ...presets].filter(Boolean).forEach(preset => {
      const isShared = preset === state.sharedPreset;
      const item = document.createElement("div");
      item.className = `preset-item${preset.id === defaultId ? " is-default" : ""}${isShared ? " is-shared" : ""}`;
      const info = document.createElement("div");
      info.className = "preset-item-info";
      const thumbnail = document.createElement("div");
      thumbnail.className = "preset-thumb";
      if (preset.thumbnailBlob) showPresetThumbnail(thumbnail, preset.thumbnailBlob, preset.name);
      else if (preset.imageFile && !isShared) {
        thumbnail.textContent = "生成中";
        legacyThumbnails.push({ preset, container: thumbnail });
      } else thumbnail.textContent = "无底图";
      const main = document.createElement("div");
      main.className = "preset-item-main";
      const title = document.createElement("div");
      title.className = "preset-item-name";
      const name = document.createElement("strong");
      name.textContent = preset.name;
      title.append(name);
      if (preset.id === defaultId || isShared) {
        const badge = document.createElement("span");
        badge.className = "preset-default-badge";
        badge.textContent = isShared ? "此网页附带" : "下次默认";
        title.append(badge);
      }
      const meta = document.createElement("span");
      meta.className = "preset-item-meta";
      meta.textContent = `${isShared ? "打开网页自动载入" : new Date(preset.savedAt).toLocaleString("zh-CN")} · ${preset.imageFile ? `含底图 ${preset.imageFile.name}` : "不含底图"}${preset.fontFile ? " · 含本机字体" : ""}`;
      main.append(title, meta);
      info.append(thumbnail, main);
      const actions = document.createElement("div");
      actions.className = "preset-item-actions";
      const addAction = (label, handler, className = "") => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (className) button.className = className;
        button.addEventListener("click", handler);
        actions.append(button);
      };
      addAction("载入", async () => {
        if (presetBusy || state.running) return;
        presetBusy = true;
        try { await applyPreset(preset); refs.presetDialog.close(); }
        catch (error) { console.error(error); notify("预设载入失败，请检查已保存的底图或字体。", true); }
        finally { presetBusy = false; }
      });
      if (isShared) addAction("存到本机", async () => {
        if (presetBusy) return;
        presetBusy = true;
        try {
          if (presets.length >= PRESET_LIMIT) throw new Error("本机已保存 10 组预设，请先删除一组");
          const copy = { ...preset, id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, savedAt: Date.now() };
          await writePreset(copy);
          notify("已存到本机，并设为本机默认预设。");
        } catch (error) { console.error(error); notify(`保存失败：${error.message}`, true); }
        finally { presetBusy = false; refreshPresetList().catch(() => {}); }
      });
      else addAction("覆盖", () => preparePresetOverwrite(preset));
      if (!isShared && preset.id !== defaultId) addAction("设为默认", async () => {
        try { await changeDefaultPreset(preset.id); await refreshPresetList(); notify(`下次将默认载入：${preset.name}`); }
        catch (error) { console.error(error); notify("设置默认预设失败。", true); }
      });
      if (!isShared) addAction("删除", async () => {
        if (presetBusy || !window.confirm(`删除预设“${preset.name}”？此操作无法撤销。`)) return;
        presetBusy = true;
        try {
          const nextDefaultId = preset.id === defaultId ? (presets.find(item => item.id !== preset.id)?.id || null) : defaultId;
          await removePreset(preset.id, nextDefaultId);
          await refreshPresetList();
          notify("预设已删除。");
        } catch (error) { console.error(error); notify("删除预设失败。", true); }
        finally { presetBusy = false; refreshPresetList().catch(() => {}); }
      }, "preset-delete");
      const shareActions = document.createElement("div");
      shareActions.className = "preset-item-share";
      for (const [label, asPage] of [["导出预设文件", false], ["生成共享网页", true]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => exportPortablePreset(preset, asPage));
        shareActions.append(button);
      }
      item.append(info, actions, shareActions);
      refs.presetList.append(item);
    });
    if (legacyThumbnails.length) void fillLegacyPresetThumbnails(legacyThumbnails, generation);
  }

  async function saveCurrentPreset(existing = presetOverwriteTarget) {
    if (presetBusy || state.running) return;
    renderPresetSaveSummary();
    presetBusy = true;
    refs.presetSaveBtn.disabled = true;
    try {
      const { presets } = await readPresetState();
      if (!existing && presets.length >= PRESET_LIMIT) return notify("最多保存 10 组配置；可覆盖或删除已有预设。", true);
      if (existing && !presets.some(preset => preset.id === existing.id)) return notify("该预设已不存在，请重新选择。", true);
      const name = refs.presetName.value.trim() || existing?.name || `配置 ${presets.length + 1}`;
      const preset = {
        id: existing?.id || (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        name, savedAt: Date.now(), config: capturePresetConfig(),
        imageFile: state.sourceFile || null, fontFile: state.customFontFile || null,
        thumbnailBlob: state.source ? await createThumbnailBlob(state.source) : null
      };
      await writePreset(preset);
      let folderSyncError = null;
      if (state.folderSource?.kind === "handle") {
        try { await saveFolderPreset(preset); }
        catch (error) { console.error("工作文件夹同步失败", error); folderSyncError = error; }
      }
      resetPresetSaveMode();
      await refreshPresetList();
      notify(folderSyncError
        ? `本机已保存“${name}”，但工作文件夹写入失败：${folderSyncError.message}`
        : `已保存“${name}”${state.folderSource?.kind === "handle" ? "并同步到工作文件夹" : ""}，下次打开将自动载入。`, Boolean(folderSyncError));
    } catch (error) {
      console.error(error);
      notify("保存失败：浏览器存储空间不足或禁止本地存储。", true);
    } finally { presetBusy = false; refreshPresetList().catch(() => {}); }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  function textStyle() {
    return {
      family: state.fontFamily,
      size: clamp(Number(refs.fontSize.value) || 120, 6, 2000),
      color: refs.textColor.value,
      weight: refs.fontWeight.value,
      spacing: Number(refs.letterSpacing.value) || 0,
      align: refs.textAlign.value,
      valign: refs.verticalAlign.value,
      lineEnabled: refs.textLineEnabled.checked,
      lineColor: refs.textLineColor.value,
      lineWidth: clamp(Number(refs.textLineWidth.value) || 1, 1, 200),
      lineGap: clamp(Number(refs.textLineGap.value) || 0, 0, 500),
      lineExtendLeft: clamp(Number(refs.textLineExtendLeft.value) || 0, 0, 1000),
      lineExtendRight: clamp(Number(refs.textLineExtendRight.value) || 0, 0, 1000)
    };
  }

  function measureSpacedText(ctx, text, spacing) {
    const chars = Array.from(text);
    return chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) + Math.max(0, chars.length - 1) * spacing;
  }

  function fitRegionToText(textToMeasure = currentName()) {
    if (!state.source || !state.width || !state.height) return;
    const style = textStyle();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${style.weight} ${style.size}px ${style.family}`;
    const text = textToMeasure;
    const metrics = ctx.measureText(text || " ");
    const ascent = metrics.actualBoundingBoxAscent || style.size * .8;
    const descent = metrics.actualBoundingBoxDescent || style.size * .2;
    // 同时采用整串和逐字测量的较大值，并留出极小的抗锯齿余量，避免字体边缘被截断。
    const textWidth = Math.max(ctx.measureText(text).width, measureSpacedText(ctx, text, style.spacing)) + 2;
    const x = clamp(state.region.x, 0, 1 - 1 / state.width);
    const y = clamp(state.region.y, 0, 1 - 1 / state.height);
    // 自动贴合时固定左上角，让文字增长只推动右边框向右延伸。
    const w = clamp(textWidth / state.width, 1 / state.width, 1 - x);
    const h = clamp((ascent + descent) / state.height, 1 / state.height, 1 - y);
    state.region = { x, y, w, h };
    canvas.width = canvas.height = 1;
  }

  function drawText(ctx, text, scaleX, scaleY) {
    const style = textStyle();
    const region = {
      x: state.region.x * state.width * scaleX,
      y: state.region.y * state.height * scaleY,
      w: state.region.w * state.width * scaleX,
      h: state.region.h * state.height * scaleY
    };
    const requested = style.size * scaleY;
    const scaledStyle = { ...style, spacing: style.spacing * scaleX };
    const lineWidth = style.lineEnabled ? style.lineWidth * scaleY : 0;
    const lineGap = style.lineEnabled ? style.lineGap * scaleY : 0;
    const lineExtendLeft = style.lineEnabled ? style.lineExtendLeft * scaleX : 0;
    const lineExtendRight = style.lineEnabled ? style.lineExtendRight * scaleX : 0;
    const size = requested;
    const spacing = scaledStyle.spacing * (size / requested || 1);
    ctx.save();
    ctx.beginPath();
    // 编辑框只负责定位、对齐和尺寸交互；实际文字仅在整张图片边界处裁切，
    // 避免未选中编辑框时因字体像素边缘或异步字体度量误差截掉末尾文字。
    ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.clip();
    ctx.fillStyle = style.color;
    ctx.font = `${style.weight} ${size}px ${style.family}`;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(text || " ");
    const ascent = metrics.actualBoundingBoxAscent || size * .8;
    const descent = metrics.actualBoundingBoxDescent || size * .2;
    let baseline = region.y + ascent;
    if (style.valign === "middle") baseline = region.y + (region.h - ascent - descent) / 2 + ascent;
    if (style.valign === "bottom") baseline = region.y + region.h - descent;
    const width = measureSpacedText(ctx, text, spacing);
    let x = region.x;
    if (style.align === "center") x += (region.w - width) / 2;
    if (style.align === "right") x += region.w - width;
    const textX = x;
    for (const char of Array.from(text)) {
      ctx.fillText(char, x, baseline);
      x += ctx.measureText(char).width + spacing;
    }
    if (style.lineEnabled && width > 0) {
      ctx.beginPath();
      ctx.strokeStyle = style.lineColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "butt";
      const lineY = baseline + descent + lineGap + lineWidth / 2;
      ctx.moveTo(textX - lineExtendLeft, lineY);
      ctx.lineTo(textX + width + lineExtendRight, lineY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function layoutPreview() {
    if (!state.source) return;
    const availableWidth = Math.max(240, refs.previewShell.clientWidth - 48);
    const availableHeight = Math.max(240, refs.previewShell.clientHeight - 48);
    state.fitScale = Math.min(1, availableWidth / state.width, availableHeight / state.height);
    if (state.zoomMode === "fit") state.viewScale = state.fitScale;
    state.viewScale = clamp(state.viewScale, Math.max(.01, state.fitScale * .25), 4);
    const zoomRatio = state.viewScale / Math.max(.01, state.fitScale);
    const canvasGutter = Math.round(clamp(30 + Math.max(0, zoomRatio - 1) * 18, 30, 120));
    refs.previewStage.style.padding = `${canvasGutter}px`;
    const cssWidth = Math.max(1, Math.round(state.width * state.viewScale));
    const cssHeight = Math.max(1, Math.round(state.height * state.viewScale));
    refs.previewViewport.style.width = `${cssWidth}px`;
    refs.previewViewport.style.height = `${cssHeight}px`;
    const pixelBudgetRatio = Math.sqrt(16000000 / Math.max(1, cssWidth * cssHeight));
    const renderRatio = Math.max(.05, Math.min(2, window.devicePixelRatio || 1, state.width / cssWidth, state.height / cssHeight, pixelBudgetRatio));
    refs.previewCanvas.width = Math.max(1, Math.round(cssWidth * renderRatio));
    refs.previewCanvas.height = Math.max(1, Math.round(cssHeight * renderRatio));
    refs.zoomLevelBtn.textContent = `${Math.round(state.viewScale * 100)}%`;
    refs.zoomOutBtn.disabled = false;
    refs.zoomInBtn.disabled = false;
    refs.fitViewBtn.disabled = false;
    refs.actualSizeBtn.disabled = false;
    renderPreview();
  }

  function zoomTo(targetScale, anchorX, anchorY) {
    if (!state.source) return;
    const shell = refs.previewShell;
    const before = refs.previewViewport.getBoundingClientRect();
    const shellBounds = shell.getBoundingClientRect();
    const x = Number.isFinite(anchorX) ? anchorX : shellBounds.left + shell.clientWidth / 2;
    const y = Number.isFinite(anchorY) ? anchorY : shellBounds.top + shell.clientHeight / 2;
    const imageX = clamp((x - before.left) / Math.max(1, before.width), 0, 1);
    const imageY = clamp((y - before.top) / Math.max(1, before.height), 0, 1);
    state.zoomMode = "manual";
    state.viewScale = clamp(targetScale, Math.max(.01, state.fitScale * .25), 4);
    layoutPreview();
    const after = refs.previewViewport.getBoundingClientRect();
    shell.scrollLeft += after.left + imageX * after.width - x;
    shell.scrollTop += after.top + imageY * after.height - y;
  }

  function fitView() {
    if (!state.source) return;
    state.zoomMode = "fit";
    layoutPreview();
    refs.previewShell.scrollLeft = 0;
    refs.previewShell.scrollTop = 0;
  }

  function renderPreview() {
    refs.previewShell.classList.toggle("canvas-ready", Boolean(state.source));
    if (!state.source) {
      refs.previewShell.scrollLeft = 0;
      refs.previewShell.scrollTop = 0;
      refs.emptyPreview.style.display = "block";
      refs.previewViewport.style.display = "none";
      refs.zoomLevelBtn.textContent = "—%";
      refs.zoomOutBtn.disabled = true;
      refs.zoomInBtn.disabled = true;
      refs.fitViewBtn.disabled = true;
      refs.actualSizeBtn.disabled = true;
      return;
    }
    // 最终渲染前强制让实际 regionBox 跟随当前文字宽度。
    // 这样即使输入法、浏览器表单恢复或其他控件跳过了 input 回调，
    // 行内 width 也不会继续停留在默认的 13.2%。拖拽期间除外。
    if (state.names.length && !drag && state.regionAutoSize) {
      state.regionAutoSize = true;
      state.regionSizeManuallyAdjusted = false;
      fitRegionToText(currentName());
    }
    refs.emptyPreview.style.display = "none";
    refs.previewViewport.style.display = "block";
    const canvas = refs.previewCanvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.source, 0, 0, canvas.width, canvas.height);
    drawText(ctx, currentName(), canvas.width / state.width, canvas.height / state.height);
    updateRegionBox();
    refs.currentName.textContent = state.names.length ? `${state.current + 1} / ${state.names.length} · ${currentName()}` : "输入文字后可切换预览";
  }

  function updateRegionBox() {
    const r = state.region;
    Object.assign(refs.regionBox.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
    refs.regionX.value = (r.x * 100).toFixed(1);
    refs.regionY.value = (r.y * 100).toFixed(1);
    refs.regionW.value = (r.w * 100).toFixed(1);
    refs.regionH.value = (r.h * 100).toFixed(1);
  }

  function updateRegionFromInputs(event) {
    const x = clamp((Number(refs.regionX.value) || 0) / 100, 0, .99);
    const y = clamp((Number(refs.regionY.value) || 0) / 100, 0, .99);
    const w = clamp((Number(refs.regionW.value) || 1) / 100, .01, 1 - x);
    const h = clamp((Number(refs.regionH.value) || 1) / 100, .01, 1 - y);
    state.region = { x, y, w, h };
    if (event?.target === refs.regionW || event?.target === refs.regionH) {
      state.regionAutoSize = false;
      state.regionSizeManuallyAdjusted = true;
    }
    updateAll(false);
  }

  function renderGallery() {
    refs.gallery.replaceChildren();
    const totalPages = Math.ceil(state.names.length / state.pageSize);
    refs.pageInfo.textContent = totalPages ? `${state.galleryPage + 1} / ${totalPages}` : "0 / 0";
    refs.galleryPrev.disabled = state.galleryPage <= 0;
    refs.galleryNext.disabled = state.galleryPage >= totalPages - 1;
    refs.galleryEmpty.style.display = (!state.source || !state.names.length) ? "block" : "none";
    if (!state.source || !state.names.length) return;

    const start = state.galleryPage * state.pageSize;
    state.names.slice(start, start + state.pageSize).forEach((name, offset) => {
      const index = start + offset;
      const card = document.createElement("article");
      card.className = `card${index === state.current ? " selected" : ""}`;
      card.title = "点击设为当前预览";
      const imageWrap = document.createElement("div");
      imageWrap.className = "card-image";
      imageWrap.style.aspectRatio = `${state.width} / ${state.height}`;
      const image = document.createElement("img");
      image.src = state.sourceUrl;
      image.alt = `${name} 的效果预览`;
      const overlay = document.createElement("div");
      overlay.className = "card-text";
      const style = textStyle();
      Object.assign(overlay.style, {
        left: `${state.region.x * 100}%`, top: `${state.region.y * 100}%`, width: `${state.region.w * 100}%`, height: `${state.region.h * 100}%`,
        color: style.color, fontFamily: style.family, fontWeight: style.weight,
        fontSize: `clamp(6px, ${(style.size / state.width * 100).toFixed(5)}cqw, 42px)`,
        letterSpacing: `${(style.spacing / state.width * 100).toFixed(5)}cqw`,
        justifyContent: style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center",
        alignItems: style.valign === "top" ? "flex-start" : style.valign === "bottom" ? "flex-end" : "center"
      });
      const overlayText = document.createElement("span");
      overlayText.className = "card-text-value";
      overlayText.textContent = name;
      if (style.lineEnabled) {
        const overlayLine = document.createElement("span");
        overlayLine.className = "card-text-underline";
        Object.assign(overlayLine.style, {
          left: `${(-style.lineExtendLeft / state.width * 100).toFixed(5)}cqw`,
          right: `${(-style.lineExtendRight / state.width * 100).toFixed(5)}cqw`,
          top: `calc(100% + ${(style.lineGap / state.width * 100).toFixed(5)}cqw)`,
          height: `${Math.max(.35, style.lineWidth / state.width * 100).toFixed(5)}cqw`,
          background: style.lineColor
        });
        overlayText.append(overlayLine);
      }
      overlay.append(overlayText);
      imageWrap.append(image, overlay);

      const foot = document.createElement("div");
      foot.className = "card-foot";
      const label = document.createElement("div");
      label.className = "card-name";
      label.textContent = `${String(index + 1).padStart(3, "0")} · ${name}`;
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "复制";
      const download = document.createElement("button"); download.type = "button"; download.textContent = "下载";
      copy.addEventListener("click", async e => { e.stopPropagation(); await copyImage(index); });
      download.addEventListener("click", async e => { e.stopPropagation(); await downloadImage(index); });
      actions.append(copy, download); foot.append(label, actions); card.append(imageWrap, foot);
      card.addEventListener("click", () => { state.current = index; updateAll(false); });
      refs.gallery.append(card);
    });
  }

  function updateAll(relayout = true) {
    if (state.regionAutoSize && state.source) fitRegionToText();
    refs.prevBtn.disabled = state.names.length < 2;
    refs.nextBtn.disabled = state.names.length < 2;
    refs.copyBtn.disabled = !state.source;
    refs.downloadBtn.disabled = !state.source;
    refs.outputSettingsBtn.disabled = state.running;
    refs.exportFolderBtn.disabled = !state.source || !state.names.length || state.running;
    refs.cancelBtn.disabled = !state.running;
    refs.qualityField.querySelector(".quality-slider").style.opacity = refs.outputType.value === "image/png" ? ".45" : "1";
    if (relayout && state.source) layoutPreview(); else renderPreview();
    renderGallery();
  }

  function createOutputCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = state.width;
    canvas.height = state.height;
    return canvas;
  }

  function renderOutput(canvas, name) {
    const ctx = canvas.getContext("2d", { alpha: refs.outputType.value === "image/png" });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.source, 0, 0, state.width, state.height);
    drawText(ctx, name, 1, 1);
  }

  function canvasBlob(canvas, type = refs.outputType.value) {
    const quality = Number(refs.quality.value) / 100;
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片编码失败")), type, quality));
  }

  function extension(type = refs.outputType.value) { return type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png"; }
  function safeName(value) { return value.replace(/[\\/:*?"<>|\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim() || "未命名"; }
  function fileNameFor(index, name, type = refs.outputType.value) {
    const prefix = safeName(refs.filePrefix.value).replace(/^未命名$/, refs.filePrefix.value.trim() ? "未命名" : "");
    const serial = refs.includeIndex.checked ? `${String(index + 1).padStart(3, "0")}_` : "";
    return `${prefix}${serial}${safeName(name)}.${extension(type)}`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.style.display = "none";
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copyImage(index = state.current) {
    if (!state.source) return notify("请先上传底图。", true);
    const name = state.names[index] || currentName();
    try {
      const canvas = createOutputCanvas();
      renderOutput(canvas, name);
      const blob = await canvasBlob(canvas, "image/png");
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("当前浏览器不支持图片剪贴板");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      canvas.width = canvas.height = 1;
      notify(`已复制：${name}`);
    } catch (error) {
      console.warn(error);
      notify("浏览器不允许复制图片，请使用下载按钮或通过本地服务打开。", true);
    }
  }

  async function downloadImage(index = state.current) {
    if (!state.source) return notify("请先上传底图。", true);
    const name = state.names[index] || currentName();
    try {
      const canvas = createOutputCanvas();
      renderOutput(canvas, name);
      const blob = await canvasBlob(canvas);
      triggerDownload(blob, fileNameFor(index, name));
      canvas.width = canvas.height = 1;
      notify(`已生成：${name}`);
    } catch (error) { console.error(error); notify("生成图片失败，图片可能过大。", true); }
  }

  function uniqueBatchNames() {
    const used = new Map();
    return state.names.map((name, index) => {
      const proposed = fileNameFor(index, name);
      const key = proposed.toLocaleLowerCase();
      const count = (used.get(key) || 0) + 1;
      used.set(key, count);
      if (count === 1) return proposed;
      const dot = proposed.lastIndexOf(".");
      return `${proposed.slice(0, dot)}_${count}${proposed.slice(dot)}`;
    });
  }

  function setExportState(running) {
    state.running = running;
    refs.outputSettingsBtn.disabled = running;
    refs.exportFolderBtn.disabled = running || !state.source || !state.names.length;
    refs.cancelBtn.disabled = !running;
    refs.progressWrap.style.display = running ? "block" : refs.progressWrap.style.display;
  }

  function setProgress(done, total, name) {
    refs.progressBar.style.width = `${total ? done / total * 100 : 0}%`;
    refs.progressText.textContent = done >= total ? `已完成 ${total} 张` : `正在生成 ${done + 1} / ${total}：${name}`;
  }

  function openOutputDialog(mode = "settings") {
    if (state.running) return;
    refs.outputDialog.dataset.mode = mode;
    refs.outputDialogTitle.textContent = mode === "export" ? "确认本次输出设置" : "输出设置";
    refs.outputDialogConfirm.textContent = mode === "export" ? "开始批量导出" : "完成";
    if (typeof refs.outputDialog.showModal === "function") refs.outputDialog.showModal();
    else refs.outputDialog.setAttribute("open", "");
    requestAnimationFrame(syncQualityControl);
  }

  function closeOutputDialog() {
    if (typeof refs.outputDialog.close === "function") refs.outputDialog.close();
    else refs.outputDialog.removeAttribute("open");
  }

  async function exportBatch() {
    if (!state.source || !state.names.length || state.running) return;
    state.cancelled = false;
    let directory = null;
    if ("showDirectoryPicker" in window) {
      try { directory = await window.showDirectoryPicker({ mode: "readwrite" }); }
      catch (error) { if (error.name !== "AbortError") notify("无法打开目标文件夹。", true); return; }
    } else {
      notify("当前浏览器不支持文件夹写入，将改为逐张下载。");
    }

    setExportState(true);
    const canvas = createOutputCanvas();
    const filenames = uniqueBatchNames();
    let completed = 0;
    try {
      for (let index = 0; index < state.names.length; index++) {
        if (state.cancelled) break;
        const name = state.names[index];
        setProgress(index, state.names.length, name);
        renderOutput(canvas, name);
        const blob = await canvasBlob(canvas);
        if (directory) {
          const handle = await directory.getFileHandle(filenames[index], { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          triggerDownload(blob, filenames[index]);
          await new Promise(resolve => setTimeout(resolve, 350));
        }
        completed++;
        if (index % 3 === 2) await new Promise(requestAnimationFrame);
      }
      setProgress(completed, state.names.length, "");
      notify(state.cancelled ? `已取消，完成 ${completed} 张。` : `全部完成，共导出 ${completed} 张。`);
    } catch (error) {
      console.error(error);
      notify(`导出中断，已完成 ${completed} 张。`, true);
    } finally {
      canvas.width = canvas.height = 1;
      setExportState(false);
    }
  }

  const openImagePicker = () => {
    refs.imageInput.value = "";
    refs.imageInput.click();
  };
  refs.imageInput.addEventListener("change", () => loadImage(refs.imageInput.files[0]));
  refs.canvasUploadBtn.addEventListener("click", openImagePicker);
  refs.emptyPreview.addEventListener("click", openImagePicker);
  refs.previewShell.addEventListener("click", e => {
    if (!state.source && !e.target.closest(".canvas-upload-bar, .empty-preview")) openImagePicker();
  });
  refs.previewShell.addEventListener("dragenter", e => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    canvasDragDepth++;
    refs.previewShell.classList.add("drop-ready");
  });
  refs.previewShell.addEventListener("dragover", e => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    refs.previewShell.classList.add("drop-ready");
  });
  refs.previewShell.addEventListener("dragleave", e => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    canvasDragDepth = Math.max(0, canvasDragDepth - 1);
    if (!canvasDragDepth) refs.previewShell.classList.remove("drop-ready");
  });
  refs.previewShell.addEventListener("drop", e => {
    e.preventDefault();
    canvasDragDepth = 0;
    refs.previewShell.classList.remove("drop-ready");
    const file = Array.from(e.dataTransfer?.files || []).find(item => item.type.startsWith("image/"));
    loadImage(file);
  });
  refs.namesInput.addEventListener("input", () => { parseNames(); scheduleTextRegionSync(); });
  refs.namesInput.addEventListener("compositionend", () => { parseNames(); scheduleTextRegionSync(); });
  refs.namesInput.addEventListener("change", () => { parseNames(); scheduleTextRegionSync(); });
  refs.namesInput.addEventListener("paste", scheduleTextRegionSync);
  refs.namesInput.addEventListener("keyup", scheduleTextRegionSync);

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!state.source || !state.names.length) return;
      state.regionAutoSize = true;
      fitRegionToText();
      updateRegionBox();
      renderPreview();
    });
  }

  function applyColorText(finalize = false) {
    const hex = refs.colorText.value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      refs.textColor.value = `#${hex}`;
      if (finalize) refs.colorText.value = `#${hex.toUpperCase()}`;
      updateAll(false);
      return;
    }
    if (finalize) refs.colorText.value = refs.textColor.value.toUpperCase();
  }

  function applyLineColorText(finalize = false) {
    const hex = refs.textLineColorText.value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      refs.textLineColor.value = `#${hex}`;
      if (finalize) refs.textLineColorText.value = `#${hex.toUpperCase()}`;
      updateAll(false);
      return;
    }
    if (finalize) refs.textLineColorText.value = refs.textLineColor.value.toUpperCase();
  }

  function syncLineControls() {
    const disabled = !refs.textLineEnabled.checked;
    refs.textLineSettings.hidden = disabled;
    [refs.textLineColor, refs.textLineColorText, refs.textLineWidth, refs.textLineGap, refs.textLineExtendLeft, refs.textLineExtendRight].forEach(control => { control.disabled = disabled; });
    updateAll(false);
  }

  [refs.fontSize, refs.fontWeight, refs.letterSpacing, refs.textAlign, refs.verticalAlign, refs.textLineWidth, refs.textLineGap, refs.outputType].forEach(el => el.addEventListener("input", () => updateAll(false)));
  refs.textLineExtendLeft.addEventListener("input", () => {
    const nextValue = clamp(Number(refs.textLineExtendLeft.value) || 0, 0, 1000);
    const delta = nextValue - previousLineExtendLeft;
    previousLineExtendLeft = nextValue;
    if (state.source && state.width) state.region.x = clamp(state.region.x + delta / state.width, 0, 1 - state.region.w);
    const autoSize = state.regionAutoSize;
    state.regionAutoSize = false;
    updateAll(false);
    state.regionAutoSize = autoSize;
  });
  refs.textLineExtendRight.addEventListener("input", () => {
    const autoSize = state.regionAutoSize;
    state.regionAutoSize = false;
    updateAll(false);
    state.regionAutoSize = autoSize;
  });
  refs.fontSelect.addEventListener("change", () => {
    state.fontFamily = refs.fontSelect.value;
    if (state.customFontUrl) URL.revokeObjectURL(state.customFontUrl);
    state.customFontUrl = "";
    state.customFontFile = null;
    refs.customFontOption.hidden = true;
    refs.fontFile.value = "";
    updateAll(false);
  });
  refs.textColor.addEventListener("input", () => { refs.colorText.value = refs.textColor.value.toUpperCase(); updateAll(false); });
  refs.colorText.addEventListener("input", () => applyColorText(false));
  refs.colorText.addEventListener("change", () => applyColorText(true));
  refs.textLineEnabled.addEventListener("change", syncLineControls);
  refs.textLineColor.addEventListener("input", () => { refs.textLineColorText.value = refs.textLineColor.value.toUpperCase(); updateAll(false); });
  refs.textLineColorText.addEventListener("input", () => applyLineColorText(false));
  refs.textLineColorText.addEventListener("change", () => applyLineColorText(true));
  function syncQualityControl() {
    const value = clamp(Number(refs.quality.value) || 0, 0, 100);
    refs.qualityValue.textContent = `${value}%`;
    const slider = refs.quality.closest(".quality-slider");
    const qualityHeights = [.32, .33, .35, .37, .39, .42, .45, .48, .51, .54, .58, .63, .69, .75, .81, .87, .92, .96, 1, 1];
    const levelIndex = Math.max(0, Math.min(19, value / 5 - 1));
    let segmentHeight = (slider.clientHeight - 8) * qualityHeights[levelIndex];
    let indicatorHeight = Math.max(12, segmentHeight * .72);
    let indicatorTop = slider.clientHeight - 4 - (segmentHeight + indicatorHeight) / 2;
    const segmentTrack = slider?.querySelector(".quality-segments");
    const segments = segmentTrack?.querySelectorAll("i");
    const activeSegment = segments?.[levelIndex];
    if (slider?.clientWidth && segmentTrack && activeSegment) {
      const segmentCenter = segmentTrack.offsetLeft + activeSegment.offsetLeft + activeSegment.offsetWidth / 2;
      segmentHeight = activeSegment.offsetHeight;
      indicatorHeight = Math.max(12, segmentHeight * .72);
      indicatorTop = segmentTrack.offsetTop + activeSegment.offsetTop + (segmentHeight - indicatorHeight) / 2;
      slider.style.setProperty("--quality-position", `${segmentCenter}px`);
      slider.style.setProperty("--quality-offset", "0px");
    } else {
      slider?.style.setProperty("--quality-position", `${value - 2.5}%`);
      slider?.style.setProperty("--quality-offset", `${(value / 5) * .1 - 1.05}px`);
    }
    slider?.style.setProperty("--quality-indicator-height", `${indicatorHeight}px`);
    slider?.style.setProperty("--quality-indicator-top", `${indicatorTop}px`);
    segments?.forEach((segment, index) => {
      segment.classList.toggle("is-active", value >= (index + 1) * 5);
    });
  }
  function playQualitySnap() {
    const slider = refs.quality.closest(".quality-slider");
    const indicator = slider?.querySelector(".quality-indicator");
    const segments = slider?.querySelectorAll(".quality-segments i");
    const current = segments?.[Math.max(0, Number(refs.quality.value) / 5 - 1)];
    indicator?.classList.remove("is-snapping");
    segments?.forEach(segment => segment.classList.remove("is-snapping"));
    void slider?.offsetWidth;
    indicator?.classList.add("is-snapping");
    current?.classList.add("is-snapping");
  }
  refs.quality.addEventListener("input", () => { syncQualityControl(); playQualitySnap(); });
  const qualitySlider = refs.quality.closest(".quality-slider");
  let qualityPress = null;
  const setQualityFromPointer = clientX => {
    const bounds = qualitySlider.getBoundingClientRect();
    const level = clamp(Math.floor(((clientX - bounds.left) / Math.max(1, bounds.width)) * 20) + 1, 1, 20);
    const value = level * 5;
    if (Number(refs.quality.value) === value) return;
    refs.quality.value = String(value);
    syncQualityControl();
    playQualitySnap();
  };
  qualitySlider.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    refs.quality.focus({ preventScroll: true });
    qualitySlider.setPointerCapture(event.pointerId);
    qualityPress = { pointerId: event.pointerId, clientX: event.clientX, dragging: false, timer: 0 };
    setQualityFromPointer(event.clientX);
    qualityPress.timer = window.setTimeout(() => {
      if (!qualityPress || qualityPress.pointerId !== event.pointerId) return;
      qualityPress.dragging = true;
      qualitySlider.classList.add("is-dragging");
      setQualityFromPointer(qualityPress.clientX);
    }, 280);
  });
  qualitySlider.addEventListener("pointermove", event => {
    if (!qualityPress || qualityPress.pointerId !== event.pointerId) return;
    qualityPress.clientX = event.clientX;
    if (qualityPress.dragging) setQualityFromPointer(event.clientX);
  });
  const finishQualityPress = (event, cancelled = false) => {
    if (!qualityPress || qualityPress.pointerId !== event.pointerId) return;
    window.clearTimeout(qualityPress.timer);
    const wasDragging = qualityPress.dragging;
    qualityPress = null;
    qualitySlider.classList.remove("is-dragging");
    if (qualitySlider.hasPointerCapture(event.pointerId)) qualitySlider.releasePointerCapture(event.pointerId);
    if (wasDragging) playQualitySnap();
    else if (!cancelled) qualitySlider.closest(".section")?.querySelector(":scope > .section-title")?.click();
  };
  qualitySlider.addEventListener("pointerup", event => finishQualityPress(event));
  qualitySlider.addEventListener("pointercancel", event => finishQualityPress(event, true));
  syncQualityControl();
  refs.fontFile.addEventListener("change", async () => {
    const file = refs.fontFile.files[0]; if (!file) return;
    try {
      await loadCustomFont(file);
    } catch (error) { console.error(error); notify("字体加载失败，请确认文件格式。", true); }
  });

  [refs.regionX, refs.regionY, refs.regionW, refs.regionH].forEach(el => el.addEventListener("change", updateRegionFromInputs));
  refs.prevBtn.addEventListener("click", () => { if (!state.names.length) return; state.current = (state.current - 1 + state.names.length) % state.names.length; updateAll(false); });
  refs.nextBtn.addEventListener("click", () => { if (!state.names.length) return; state.current = (state.current + 1) % state.names.length; updateAll(false); });
  refs.zoomOutBtn.addEventListener("click", () => zoomTo(state.viewScale / 1.25));
  refs.zoomInBtn.addEventListener("click", () => zoomTo(state.viewScale * 1.25));
  refs.zoomLevelBtn.addEventListener("click", fitView);
  refs.fitViewBtn.addEventListener("click", fitView);
  refs.actualSizeBtn.addEventListener("click", () => zoomTo(1));
  let ctrlZoomMode = false;
  function syncCtrlZoomMode() {
    refs.directZoomBtn.classList.toggle("is-active", !ctrlZoomMode);
    refs.ctrlZoomBtn.classList.toggle("is-active", ctrlZoomMode);
    refs.directZoomBtn.setAttribute("aria-pressed", String(!ctrlZoomMode));
    refs.ctrlZoomBtn.setAttribute("aria-pressed", String(ctrlZoomMode));
    refs.previewShell.title = ctrlZoomMode
      ? "拖入图片可上传或替换；Ctrl + 滚轮缩放；滚轮上下移动；Shift + 滚轮左右移动；拖动画布空白处可平移"
      : "拖入图片可上传或替换；滚轮缩放；Shift + 滚轮左右移动；拖动画布空白处可平移";
  }
  refs.directZoomBtn.addEventListener("click", () => { ctrlZoomMode = false; syncCtrlZoomMode(); });
  refs.ctrlZoomBtn.addEventListener("click", () => { ctrlZoomMode = true; syncCtrlZoomMode(); });
  syncCtrlZoomMode();
  refs.previewShell.addEventListener("wheel", e => {
    if (!state.source) {
      e.preventDefault();
      refs.previewShell.scrollLeft = 0;
      refs.previewShell.scrollTop = 0;
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      const horizontalDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      refs.previewShell.scrollLeft += horizontalDelta;
      return;
    }
    if (ctrlZoomMode && !e.ctrlKey) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * .0015);
    zoomTo(state.viewScale * factor, e.clientX, e.clientY);
  }, { passive: false });
  refs.previewShell.addEventListener("pointerdown", e => {
    if (!state.source || e.button !== 0 || e.target.closest(".region-box, .canvas-upload-bar")) return;
    pan = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: refs.previewShell.scrollLeft,
      scrollTop: refs.previewShell.scrollTop
    };
    refs.previewShell.setPointerCapture(e.pointerId);
    refs.previewShell.classList.add("panning");
    e.preventDefault();
  });
  refs.previewShell.addEventListener("pointermove", e => {
    if (!pan || pan.pointerId !== e.pointerId) return;
    refs.previewShell.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
    refs.previewShell.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
  });
  const stopPanning = e => {
    if (!pan || (e.pointerId !== undefined && pan.pointerId !== e.pointerId)) return;
    pan = null;
    refs.previewShell.classList.remove("panning");
  };
  refs.previewShell.addEventListener("pointerup", stopPanning);
  refs.previewShell.addEventListener("pointercancel", stopPanning);
  refs.galleryPrev.addEventListener("click", () => { state.galleryPage = Math.max(0, state.galleryPage - 1); renderGallery(); });
  refs.galleryNext.addEventListener("click", () => { state.galleryPage++; renderGallery(); });
  refs.copyBtn.addEventListener("click", () => copyImage());
  refs.downloadBtn.addEventListener("click", () => downloadImage());
  refs.outputSettingsBtn.addEventListener("click", () => openOutputDialog("settings"));
  refs.presetOpenBtn.addEventListener("click", async () => {
    resetPresetSaveMode();
    renderPresetSaveSummary();
    refs.presetList.textContent = "正在读取预设…";
    refs.presetDialog.showModal();
    try {
      await refreshPresetList();
      await renderFolderPresetList();
      refs.presetName.focus();
    } catch (error) { console.error(error); refs.presetDialog.close(); notify("当前浏览器无法使用本地预设存储。", true); }
  });
  refs.presetDialogClose.addEventListener("click", () => refs.presetDialog.close());
  refs.presetDialog.addEventListener("click", event => { if (event.target === refs.presetDialog) refs.presetDialog.close(); });
  refs.presetDialog.addEventListener("close", () => {
    resetPresetSaveMode();
    presetListGeneration++;
    clearPresetThumbnailUrls();
    folderThumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    folderThumbnailUrls.length = 0;
    refs.presetList.querySelectorAll("img").forEach(image => image.removeAttribute("src"));
  });
  refs.presetSaveBtn.addEventListener("click", () => saveCurrentPreset());
  refs.folderConnectBtn.addEventListener("click", async () => {
    if (presetBusy) return;
    if (!window.showDirectoryPicker) return notify("当前浏览器不支持直接写入文件夹。可使用“只读打开文件夹”载入共享预设；保存请使用新版 Chrome 或 Edge。", true);
    try {
      const handle = await window.showDirectoryPicker({ id: "batch-image-text-workspace", mode: "readwrite" });
      await handle.getDirectoryHandle("dist");
      const source = { kind: "handle", handle, name: handle.name };
      const manifest = await readFolderManifest(source);
      state.folderSource = source;
      state.folderManifest = manifest;
      await renderFolderPresetList();
      const defaultEntry = manifest.presets.find(entry => entry.id === manifest.defaultId);
      if (defaultEntry && !state.sourceFile && !refs.namesInput.value.trim()) {
        await applyPreset(await getFolderPreset(defaultEntry, source), true);
        notify(`已连接并载入文件夹默认预设：${defaultEntry.name}`);
      } else notify(`已连接工作文件夹：${handle.name}`);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error(error);
      notify(error.name === "NotFoundError" ? "请选择包含 dist 文件夹的工具工作文件夹。" : `连接失败：${error.message}`, true);
    }
  });
  refs.folderImportBtn.addEventListener("click", () => refs.folderImportInput.click());
  refs.folderImportInput.addEventListener("change", async () => {
    if (presetBusy) return;
    const selected = [...(refs.folderImportInput.files || [])];
    refs.folderImportInput.value = "";
    if (!selected.length) return;
    try {
      const files = new Map();
      for (const file of selected) {
        const relative = file.webkitRelativePath || "";
        const slash = relative.indexOf("/");
        if (slash >= 0) files.set(relative.slice(slash + 1), file);
      }
      if (!files.has("dist/index.html")) throw new Error("请选择包含 dist 文件夹的工具工作文件夹");
      const source = { kind: "files", files, name: selected[0].webkitRelativePath.split("/")[0] };
      const manifest = await readFolderManifest(source);
      state.folderSource = source;
      state.folderManifest = manifest;
      await renderFolderPresetList();
      const defaultEntry = manifest.presets.find(entry => entry.id === manifest.defaultId);
      if (defaultEntry && !state.sourceFile && !refs.namesInput.value.trim()) {
        await applyPreset(await getFolderPreset(defaultEntry, source), true);
        notify(`已载入文件夹默认预设：${defaultEntry.name}`);
      } else notify(`已只读打开工作文件夹：${source.name}`);
    } catch (error) { console.error(error); notify(`打开文件夹失败：${error.message}`, true); }
  });
  refs.folderSaveBtn.addEventListener("click", async () => {
    if (presetBusy || state.running || state.folderSource?.kind !== "handle") return;
    presetBusy = true;
    try {
      const count = state.folderManifest?.presets.length || 0;
      if (count >= PRESET_LIMIT) throw new Error("文件夹已有 10 组预设，请覆盖或删除一组");
      const preset = {
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: refs.presetName.value.trim() || `配置 ${count + 1}`,
        config: capturePresetConfig(), imageFile: state.sourceFile, fontFile: state.customFontFile,
        thumbnailBlob: state.source ? await createThumbnailBlob(state.source) : null
      };
      await saveFolderPreset(preset);
      notify(`已将“${preset.name}”保存到工作文件夹。`);
    } catch (error) { console.error(error); notify(`保存到文件夹失败：${error.message}`, true); }
    finally { presetBusy = false; }
  });
  refs.folderSyncBtn.addEventListener("click", async () => {
    if (presetBusy || state.running || state.folderSource?.kind !== "handle") return;
    presetBusy = true;
    let completed = 0;
    try {
      const { presets, defaultId } = await readPresetState();
      if (!presets.length) return notify("本机还没有可同步的预设。", true);
      const existing = new Set(state.folderManifest?.presets.map(entry => entry.id) || []);
      const newCount = presets.filter(preset => !existing.has(preset.id)).length;
      if (existing.size + newCount > PRESET_LIMIT) throw new Error("同步后会超过 10 组，请先清理文件夹中的预设");
      for (const preset of [...presets].reverse()) {
        await saveFolderPreset(preset);
        completed++;
      }
      if (defaultId && state.folderManifest.presets.some(entry => entry.id === defaultId)) {
        state.folderManifest.defaultId = defaultId;
        await writeFolderManifest(state.folderManifest);
        await renderFolderPresetList();
      }
      notify(`已将 ${completed} 组本机预设同步到工作文件夹。`);
    } catch (error) { console.error(error); notify(`同步中断（已完成 ${completed} 组）：${error.message}`, true); }
    finally { presetBusy = false; }
  });
  refs.presetImportBtn.addEventListener("click", () => refs.presetImportInput.click());
  refs.presetImportInput.addEventListener("change", async () => {
    const file = refs.presetImportInput.files?.[0];
    refs.presetImportInput.value = "";
    if (!file || presetBusy) return;
    presetBusy = true;
    try {
      const { presets } = await readPresetState();
      if (presets.length >= PRESET_LIMIT) throw new Error("本机已保存 10 组预设，请先删除一组");
      const portable = JSON.parse(await file.text());
      const preset = await preparePortablePreset(portable);
      await applyPreset(preset, true);
      await writePreset(preset);
      refs.presetDialog.close();
      refs.presetCount.textContent = `${presets.length + 1}/${PRESET_LIMIT}`;
      notify(`已导入“${preset.name}”，并设为本机默认预设。`);
    } catch (error) {
      console.error(error);
      notify(`导入失败：${error.message || "预设文件无效"}`, true);
    } finally { presetBusy = false; if (refs.presetDialog.open) refreshPresetList().catch(() => {}); }
  });
  refs.presetName.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); saveCurrentPreset(); } });
  refs.presetOverwriteCancel.addEventListener("click", () => {
    resetPresetSaveMode();
    refreshPresetList().catch(error => { console.error(error); notify("无法刷新预设列表。", true); });
  });
  refs.exportFolderBtn.addEventListener("click", () => openOutputDialog("export"));
  refs.outputDialogClose.addEventListener("click", closeOutputDialog);
  refs.outputDialogCancel.addEventListener("click", closeOutputDialog);
  refs.outputDialogConfirm.addEventListener("click", () => {
    const shouldExport = refs.outputDialog.dataset.mode === "export";
    closeOutputDialog();
    if (shouldExport) exportBatch();
    else notify("输出设置已保存，将用于下一次导出。");
  });
  refs.outputDialog.addEventListener("click", event => {
    if (event.target === refs.outputDialog) closeOutputDialog();
  });
  const closeGuideDialog = () => refs.guideDialog.close();
  refs.guideOpenBtn.addEventListener("click", () => refs.guideDialog.showModal());
  refs.guideDialogClose.addEventListener("click", closeGuideDialog);
  refs.guideDialogDone.addEventListener("click", closeGuideDialog);
  refs.guideDialog.addEventListener("click", event => {
    if (event.target === refs.guideDialog) closeGuideDialog();
  });
  refs.cancelBtn.addEventListener("click", () => {
    if (!state.running) return;
    state.cancelled = true;
    refs.cancelBtn.disabled = true;
    refs.progressText.textContent = "正在停止…";
  });

  refs.regionBox.addEventListener("wheel", e => {
    if (!state.source) return;
    e.preventDefault();
    e.stopPropagation();
    const centerX = state.region.x + state.region.w / 2;
    const centerY = state.region.y + state.region.h / 2;
    const factor = Math.exp(-e.deltaY * .0015);
    const nextSize = clamp((Number(refs.fontSize.value) || 120) * factor, 6, 2000);
    refs.fontSize.value = nextSize.toFixed(1).replace(/\.0$/, "");
    state.regionAutoSize = true;
    state.regionSizeManuallyAdjusted = false;
    fitRegionToText();
    state.region.x = clamp(centerX - state.region.w / 2, 0, 1 - state.region.w);
    state.region.y = clamp(centerY - state.region.h / 2, 0, 1 - state.region.h);
    renderPreview();
    window.clearTimeout(textWheelTimer);
    textWheelTimer = window.setTimeout(renderGallery, 120);
  }, { passive: false });

  refs.regionBox.addEventListener("dblclick", e => {
    if (!state.source) return;
    e.preventDefault();
    e.stopPropagation();
    state.region = { x: .155, y: .359, w: .132, h: .017 };
    state.regionAutoSize = false;
    state.regionSizeManuallyAdjusted = false;
    refs.regionBox.classList.add("is-editing");
    updateAll(false);
    showToast("已恢复编辑框默认位置与大小");
  });

  refs.regionBox.addEventListener("pointerdown", e => {
    if (!state.source) return;
    refs.regionBox.classList.add("is-editing");
    refs.regionBox.focus({ preventScroll: true });
    const bounds = refs.previewViewport.getBoundingClientRect();
    drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, region: { ...state.region }, fontSize: Number(refs.fontSize.value) || 120, handle: e.target.dataset.handle || "move", bounds };
    refs.regionBox.setPointerCapture(e.pointerId); e.preventDefault();
  });
  refs.regionBox.addEventListener("pointermove", e => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = (e.clientX - drag.startX) / drag.bounds.width;
    const dy = (e.clientY - drag.startY) / drag.bounds.height;
    if (Math.abs(e.clientX - drag.startX) > 2 || Math.abs(e.clientY - drag.startY) > 2) {
      refs.regionBox.classList.add("is-dragging");
    }
    let { x, y, w, h } = drag.region;
    if (drag.handle === "move") { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
    else {
      const minW = 1 / state.width;
      const minH = 1 / state.height;
      if (drag.handle.includes("e")) w = clamp(w + dx, minW, 1 - x);
      if (drag.handle.includes("s")) h = clamp(h + dy, minH, 1 - y);
      if (drag.handle.includes("w")) { const right = x + w; x = clamp(x + dx, 0, right - minW); w = right - x; }
      if (drag.handle.includes("n")) { const bottom = y + h; y = clamp(y + dy, 0, bottom - minH); h = bottom - y; }
    }
    if (drag.handle === "move") {
      state.region = { x, y, w, h };
    } else {
      const horizontalScale = w / Math.max(.0001, drag.region.w);
      const verticalScale = h / Math.max(.0001, drag.region.h);
      const usesHorizontal = /[ew]/.test(drag.handle);
      const usesVertical = /[ns]/.test(drag.handle);
      const scale = usesHorizontal && usesVertical ? Math.min(horizontalScale, verticalScale) : usesHorizontal ? horizontalScale : verticalScale;
      refs.fontSize.value = String(Math.round(clamp(drag.fontSize * scale, 6, 2000)));
      const fixedRight = drag.region.x + drag.region.w;
      const fixedBottom = drag.region.y + drag.region.h;
      state.region = { ...drag.region };
      state.regionAutoSize = true;
      state.regionSizeManuallyAdjusted = false;
      fitRegionToText();
      if (drag.handle.includes("w")) state.region.x = clamp(fixedRight - state.region.w, 0, 1 - state.region.w);
      else state.region.x = clamp(drag.region.x, 0, 1 - state.region.w);
      if (drag.handle.includes("n")) state.region.y = clamp(fixedBottom - state.region.h, 0, 1 - state.region.h);
      else state.region.y = clamp(drag.region.y, 0, 1 - state.region.h);
    }
    renderPreview();
  });
  refs.regionBox.addEventListener("pointerup", e => { if (drag && drag.pointerId === e.pointerId) { drag = null; refs.regionBox.classList.remove("is-dragging"); renderGallery(); } });
  refs.regionBox.addEventListener("pointercancel", () => { drag = null; refs.regionBox.classList.remove("is-dragging"); });
  refs.regionBox.addEventListener("focus", () => refs.regionBox.classList.add("is-editing"));
  refs.regionBox.addEventListener("blur", () => { if (!drag) refs.regionBox.classList.remove("is-editing"); });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest(".region-box")) refs.regionBox.classList.remove("is-editing");
  });
  refs.regionBox.addEventListener("keydown", e => {
    if (!state.source || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const pixels = e.shiftKey ? 10 : 1;
    const dx = (e.key === "ArrowLeft" ? -pixels : e.key === "ArrowRight" ? pixels : 0) / state.width;
    const dy = (e.key === "ArrowUp" ? -pixels : e.key === "ArrowDown" ? pixels : 0) / state.height;
    state.region.x = clamp(state.region.x + dx, 0, 1 - state.region.w);
    state.region.y = clamp(state.region.y + dy, 0, 1 - state.region.h);
    renderPreview();
  });
  refs.regionBox.addEventListener("keyup", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) renderGallery();
  });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const sidebarValue = parseFloat(document.documentElement.style.getPropertyValue("--sidebar-width"));
      const textValue = parseFloat(document.documentElement.style.getPropertyValue("--text-panel-width"));
      if (Number.isFinite(sidebarValue)) setColumnWidth("sidebar", sidebarValue);
      if (Number.isFinite(textValue)) setColumnWidth("text", textValue);
      if (state.source) layoutPreview();
      if (refs.outputDialog.open) syncQualityControl();
    }, 120);
  });
  window.addEventListener("beforeunload", () => {
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    if (state.customFontUrl) URL.revokeObjectURL(state.customFontUrl);
    if (state.source && typeof state.source.close === "function") state.source.close();
  });

  document.querySelectorAll(".sidebar .section").forEach((section, index) => {
    const title = section.querySelector(":scope > .section-title");
    const step = title?.querySelector(".step");
    if (!title || !step) return;
    const actions = document.createElement("span");
    actions.className = "section-title-actions";
    const toggleIcon = document.createElement("span");
    toggleIcon.className = "section-toggle-icon";
    toggleIcon.setAttribute("aria-hidden", "true");
    toggleIcon.innerHTML = '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
    step.replaceWith(actions);
    actions.append(step, toggleIcon);

    const body = document.createElement("div");
    const clip = document.createElement("div");
    body.className = "section-body";
    clip.className = "section-body-clip";
    while (title.nextSibling) clip.append(title.nextSibling);
    body.append(clip);
    section.append(body);

    const bodyId = `settings-section-${index + 1}`;
    body.id = bodyId;
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-controls", bodyId);
    title.setAttribute("aria-expanded", "true");
    const toggleSection = () => {
      const collapsed = section.classList.toggle("is-collapsed");
      title.setAttribute("aria-expanded", String(!collapsed));
    };
    title.addEventListener("click", toggleSection);
    section.addEventListener("click", event => {
      if (event.target.closest(".section-title, input, select, textarea, button, label, .quality-slider")) return;
      if (section.classList.contains("is-collapsed")) toggleSection();
    });
    title.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleSection();
    });
  });

  bindColumnResizer(refs.sidebarResizeHandle, "sidebar");
  bindColumnResizer(refs.textResizeHandle, "text");
  syncLineControls();
  updateRegionBox();
  updateAll();
  (async () => {
    const embedded = window.__BATCH_IMAGE_TEXT_SHARED_PRESET__;
    if (embedded) {
      try {
        state.sharedPreset = await preparePortablePreset(embedded);
        await applyPreset(state.sharedPreset, true);
        notify(`已载入此网页附带的配置：${state.sharedPreset.name}`);
      } catch (error) { console.error("共享预设载入失败", error); notify("共享网页中的预设无法载入。", true); }
    }
    try {
      const { presets, defaultId } = await readPresetState();
      refs.presetCount.textContent = `${presets.length}/${PRESET_LIMIT}`;
      if (state.sharedPreset) return;
      const defaultPreset = presets.find(preset => preset.id === defaultId);
      if (defaultPreset) {
        await applyPreset(defaultPreset, true);
        notify(`已自动载入默认配置：${defaultPreset.name}`);
      }
    } catch (error) { console.warn("本地预设不可用", error); }
  })();
})();
