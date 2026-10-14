/**
 * 批量出图 · 浏览器端
 * 移植自 batch.mjs 的核心逻辑：多通道自适应降级 + 图片完整性校验
 * 纯前端、零后端，API Key 仅存浏览器 localStorage
 */
(function () {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const baseUrlEl = $('baseUrl'), apiKeyEl = $('apiKey'), modelEl = $('model');
  const sizeEl = $('size'), qualityEl = $('quality'), imagesPerPromptEl = $('imagesPerPrompt');
  const concurrencyEl = $('concurrency'), timeoutEl = $('timeout'), retriesEl = $('retries');
  const refModeEl = $('refMode');
  const promptsEl = $('prompts');
  const refZone = $('refZone'), refDrop = $('refDrop'), refInput = $('refInput'), refList = $('refList');
  const runBtn = $('runBtn'), stopBtn = $('stopBtn'), clearBtn = $('clearBtn');
  const progressWrap = $('progressWrap'), progressBar = $('progressBar'), progressText = $('progressText');
  const logEl = $('log'), resultGrid = $('resultGrid'), resultCount = $('resultCount');
  const resultActions = $('resultActions'), downloadAllBtn = $('downloadAllBtn');

  // ---------- 状态 ----------
  let stopFlag = false;
  let refFiles = [];   // [{ name, dataUrl, mime }]

  // ---------- 工具 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalizeSize(v) {
    if (!v) return '';
    return String(v).replace(/[×xX]/g, 'x').replace(/\s+/g, '');
  }

  // 根据 base64 魔数判断扩展名
  function detectExt(b64) {
    if (/^\/9j/.test(b64)) return 'jpg';
    if (/^iVBOR/.test(b64)) return 'png';
    if (/^R0lGOD/.test(b64)) return 'gif';
    if (/^UklGR/.test(b64)) return 'webp';
    return 'png';
  }

  // 剥离 data URL 前缀
  function stripDataUrl(s) {
    const m = /^\s*data:([^;,]*)(?:;[^,]*)*,/i.exec(s);
    if (!m) return { b64: String(s).trim(), ext: null };
    const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };
    return { b64: s.slice(m[0].length).trim(), ext: extMap[m[1].toLowerCase()] || null };
  }

  // 二进制魔数校验
  function isValidImage(buf) {
    if (!buf || buf.length < 12) return false;
    const b = buf;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;
    if (b[0] === 0x42 && b[1] === 0x4d) return true;
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
    return false;
  }

  function slugify(s, max = 30) {
    const cleaned = String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/_+$/, '').slice(0, max);
    return cleaned || 'img';
  }

  function dataUrlToBlob(dataUrl) {
    const { b64 } = stripDataUrl(dataUrl);
    const mimeMatch = /^data:([^;,]+)/.exec(dataUrl);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // ---------- 日志 ----------
  function log(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = 'log-line ' + type;
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------- 配置持久化 ----------
  const CFG_KEY = 'batch-image-web-config';
  function saveCfg() {
    const cfg = {
      baseUrl: baseUrlEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim(),
      size: sizeEl.value.trim(),
      quality: qualityEl.value,
      imagesPerPrompt: imagesPerPromptEl.value,
      concurrency: concurrencyEl.value,
      timeout: timeoutEl.value,
      retries: retriesEl.value,
      refMode: refModeEl.value,
    };
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }
  function loadCfg() {
    try {
      const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      if (cfg.baseUrl) baseUrlEl.value = cfg.baseUrl;
      if (cfg.apiKey) apiKeyEl.value = cfg.apiKey;
      if (cfg.model) modelEl.value = cfg.model;
      if (cfg.size) sizeEl.value = cfg.size;
      if (cfg.quality) qualityEl.value = cfg.quality;
      if (cfg.imagesPerPrompt) imagesPerPromptEl.value = cfg.imagesPerPrompt;
      if (cfg.concurrency) concurrencyEl.value = cfg.concurrency;
      if (cfg.timeout) timeoutEl.value = cfg.timeout;
      if (cfg.retries) retriesEl.value = cfg.retries;
      if (cfg.refMode) refModeEl.value = cfg.refMode;
    } catch (e) { /* ignore */ }
    syncRefMode();
  }
  function syncRefMode() {
    refZone.classList.toggle('hidden', refModeEl.value === 'none');
  }
  [baseUrlEl, apiKeyEl, modelEl, sizeEl, qualityEl, imagesPerPromptEl, concurrencyEl, timeoutEl, retriesEl, refModeEl].forEach((el) => {
    el.addEventListener('change', saveCfg);
    el.addEventListener('input', debounce(saveCfg, 400));
  });

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------- 参考图 ----------
  refModeEl.addEventListener('change', syncRefMode);
  refDrop.addEventListener('click', () => refInput.click());
  refInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  ['dragover', 'dragenter'].forEach((ev) => refDrop.addEventListener(ev, (e) => { e.preventDefault(); refDrop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => refDrop.addEventListener(ev, (e) => { e.preventDefault(); refDrop.classList.remove('drag'); }));
  refDrop.addEventListener('drop', (e) => { handleFiles(e.dataTransfer.files); });

  function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (!files.length) { log('未识别到图片文件', 'warn'); return; }
    const mode = refModeEl.value;
    if (mode === 'single' && files.length > 1) { log('当前为「单张参考图」模式，仅保留第一张', 'warn'); }
    const keep = mode === 'single' ? files.slice(0, 1) : files;
    keep.forEach((f) => {
      if (refFiles.some((r) => r.name === f.name && r.size === f.size)) return;
      const reader = new FileReader();
      reader.onload = () => {
        refFiles.push({ name: f.name, dataUrl: reader.result, mime: f.type });
        renderRefList();
      };
      reader.readAsDataURL(f);
    });
  }

  function renderRefList() {
    refList.innerHTML = '';
    refFiles.forEach((r, i) => {
      const item = document.createElement('div');
      item.className = 'ref-item';
      const img = document.createElement('img');
      img.src = r.dataUrl;
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.textContent = '×';
      rm.onclick = () => { refFiles.splice(i, 1); renderRefList(); };
      item.appendChild(img); item.appendChild(rm);
      refList.appendChild(item);
    });
  }

  // ---------- 提示词解析 ----------
  function parsePrompts(text) {
    return text.split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  // ---------- API 调用 ----------
  function resolveEndpoint(baseUrl, kind) {
    let endpoint = baseUrl.replace(/\/+$/, '');
    if (/images\/(generations|edits)$/.test(endpoint)) {
      if (kind === 'edits') endpoint = endpoint.replace(/\/generations$/, '/edits');
      return endpoint;
    }
    return endpoint + (kind === 'edits' ? '/images/edits' : '/images/generations');
  }

  function isParamError(msg) {
    return /unknown_parameter|Unknown parameter|unsupported_?parameter|Unsupported parameter|not supported|unsupported_value|invalid_request_error/i.test(String(msg));
  }

  async function fetchWithTimeout(url, opts, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...opts, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function buildStrategies(cfg, prompt, refDataUrls) {
    const base = { model: cfg.model, prompt, n: cfg.imagesPerPrompt || 1 };
    const size = normalizeSize(cfg.size);
    if (size) base.size = size;
    if (cfg.quality) base.quality = cfg.quality;

    const imageField = refDataUrls.length === 0 ? null
      : (refDataUrls.length === 1 ? { image: refDataUrls[0] } : { image: refDataUrls });

    const list = [
      { id: 'gen+image+response_format', kind: 'generations', body: { ...base, response_format: 'b64_json', ...(imageField || {}) } },
    ];
    if (refDataUrls.length > 0) {
      list.push({ id: 'gen+image', kind: 'generations', body: { ...base, ...imageField } });
      list.push({ id: 'edits', kind: 'edits', fields: base, images: refDataUrls });
    } else {
      list.push({ id: 'gen', kind: 'generations', body: { ...base } });
    }
    return list;
  }

  async function callStrategy(cfg, s) {
    const endpoint = resolveEndpoint(cfg.baseUrl, s.kind);
    let res;
    if (s.kind === 'edits') {
      const fd = new FormData();
      for (const [k, v] of Object.entries(s.fields)) {
        if (v === undefined || v === null || v === '') continue;
        fd.append(k, String(v));
      }
      s.images.forEach((dataUrl, i) => {
        const blob = dataUrlToBlob(dataUrl);
        const key = s.images.length > 1 ? 'image[]' : 'image';
        const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'image/png';
        const ext = mime.split('/')[1] || 'png';
        fd.append(key, blob, `ref${i + 1}.${ext}`);
      });
      res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: fd,
      }, cfg.timeoutMs);
    } else {
      res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(s.body),
      }, cfg.timeoutMs);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`响应中无 data: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return data;
  }

  async function generateImage(cfg, prompt, refDataUrls) {
    const strategies = buildStrategies(cfg, prompt, refDataUrls);
    let lastErr, skipped = 0;
    for (const s of strategies) {
      try {
        const data = await callStrategy(cfg, s);
        if (skipped > 0) log(`  · 通道拒绝了前 ${skipped} 条策略，已用 [${s.id}] 出图`, 'warn');
        return data;
      } catch (e) {
        lastErr = e;
        if (isParamError(e.message)) {
          skipped++;
          log(`  · 策略 [${s.id}] 被通道拒绝，降级重试`, 'warn');
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  // ---------- 下载 ----------
  async function downloadBinary(url, timeoutMs) {
    const res = await fetchWithTimeout(url, {}, timeoutMs);
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ---------- 结果渲染 ----------
  function addResult(seq, prompt, blob, ext) {
    const url = URL.createObjectURL(blob);
    const card = document.createElement('div');
    card.className = 'result-card';

    const img = document.createElement('img');
    img.src = url;
    img.loading = 'lazy';
    img.alt = prompt;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `#${String(seq).padStart(3, '0')} ${prompt.slice(0, 24)}`;

    const dl = document.createElement('a');
    dl.className = 'dl';
    dl.textContent = '⬇';
    dl.download = `${String(seq).padStart(3, '0')}_${slugify(prompt)}.${ext}`;
    dl.href = url;

    card.appendChild(img); card.appendChild(meta); card.appendChild(dl);
    resultGrid.appendChild(card);
    card._blobUrl = url;
    card._blob = blob;
    card._filename = dl.download;
    return card;
  }

  function updateCount() {
    const n = resultGrid.children.length;
    resultCount.textContent = n ? `(${n} 张)` : '';
    resultActions.classList.toggle('hidden', n === 0);
  }

  // ---------- 主流程：并发池 ----------
  async function runPool(cfg, prompts, useRef) {
    let done = 0, ok = 0, fail = 0;
    const total = prompts.length;

    const workers = [];
    const poolSize = Math.min(cfg.concurrency, prompts.length);
    for (let w = 0; w < poolSize; w++) {
      workers.push((async () => {
        while (!stopFlag) {
          const i = idxPool;
          if (i >= total) break;
          idxPool++;
          const prompt = prompts[i];
          const seq = i + 1;
          let succeeded = false, lastErr;
          for (let attempt = 0; attempt <= cfg.retries && !stopFlag; attempt++) {
            if (attempt > 0) await sleep(3000);
            try {
              const refDataUrls = useRef ? refFiles.map((r) => r.dataUrl) : [];
              const items = await generateImage(cfg, prompt, refDataUrls);
              for (let j = 0; j < items.length; j++) {
                const item = items[j];
                let buf, ext;
                if (item.b64_json) {
                  const { b64, ext: urlExt } = stripDataUrl(item.b64_json);
                  ext = urlExt || detectExt(b64);
                  const binary = atob(b64);
                  buf = new Uint8Array(binary.length);
                  for (let k = 0; k < binary.length; k++) buf[k] = binary.charCodeAt(k);
                } else if (item.url) {
                  buf = await downloadBinary(item.url, cfg.timeoutMs);
                  ext = 'png';
                } else {
                  throw new Error('任务返回了无法识别的数据');
                }
                if (!buf.length) throw new Error('返回的图片内容为空');
                if (!isValidImage(buf)) throw new Error('解码结果不是有效图片，接口可能返回了异常数据');
                const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
                const blob = new Blob([buf], { type: mime });
                addResult(seq, prompt, blob, ext);
              }
              succeeded = true;
              ok++;
              log(`  ✓ [${seq}/${total}] ${prompt.slice(0, 40)}`, 'ok');
              break;
            } catch (e) {
              lastErr = e;
              if (attempt < cfg.retries && !stopFlag) {
                log(`  ⚠ [${seq}] 第 ${attempt + 1} 次失败(${e.message.slice(0, 80)})，重试...`, 'warn');
              }
            }
          }
          if (!succeeded) {
            fail++;
            log(`  ✗ [${seq}] 失败: ${String(lastErr?.message || lastErr).slice(0, 160)}`, 'fail');
          }
          done++;
          progressBar.style.width = (done / total * 100) + '%';
          progressText.textContent = `${done} / ${total} · 成功 ${ok} · 失败 ${fail}`;
          updateCount();
          await sleep(300);
        }
      })());
    }

    await Promise.all(workers);
    return { ok, fail };
  }

  let idxPool = 0;

  runBtn.addEventListener('click', async () => {
    const cfg = {
      baseUrl: baseUrlEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim() || 'gpt-image-1',
      size: sizeEl.value.trim(),
      quality: qualityEl.value,
      imagesPerPrompt: Math.max(1, parseInt(imagesPerPromptEl.value, 10) || 1),
      concurrency: Math.max(1, parseInt(concurrencyEl.value, 10) || 1),
      timeoutMs: (parseInt(timeoutEl.value, 10) || 240) * 1000,
      retries: parseInt(retriesEl.value, 10) || 0,
    };
    if (!cfg.baseUrl) { alert('请填写接口地址 baseUrl'); return; }
    if (!cfg.apiKey) { alert('请填写 API Key'); return; }
    const prompts = parsePrompts(promptsEl.value);
    if (!prompts.length) { alert('请输入至少一条提示词'); return; }
    const useRef = refModeEl.value !== 'none';
    if (useRef && !refFiles.length) { alert('已选择图生图模式，但未上传参考图'); return; }

    saveCfg();
    stopFlag = false;
    idxPool = 0;
    runBtn.disabled = true;
    stopBtn.classList.remove('hidden');
    progressWrap.classList.remove('hidden');
    logEl.innerHTML = '';
    log(`共 ${prompts.length} 条提示词 | 接口 ${cfg.baseUrl} | 模型 ${cfg.model}`, 'info');
    log(`并发 ${cfg.concurrency} | 尺寸 ${cfg.size || '默认'} | 参考图 ${refFiles.length} 张`, 'info');

    try {
      const { ok, fail } = await runPool(cfg, prompts, useRef);
      log('-'.repeat(50), 'info');
      log(`完成！成功 ${ok} | 失败 ${fail}`, ok === prompts.length ? 'ok' : 'warn');
    } catch (e) {
      log(`运行出错: ${e.message}`, 'fail');
    } finally {
      runBtn.disabled = false;
      stopBtn.classList.add('hidden');
    }
  });

  stopBtn.addEventListener('click', () => {
    stopFlag = true;
    log('⏹ 已请求停止，等待当前任务结束...', 'warn');
  });

  clearBtn.addEventListener('click', () => {
    resultGrid.querySelectorAll('.result-card').forEach((c) => {
      if (c._blobUrl) URL.revokeObjectURL(c._blobUrl);
    });
    resultGrid.innerHTML = '';
    logEl.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = '0 / 0';
    progressWrap.classList.add('hidden');
    updateCount();
  });

  downloadAllBtn.addEventListener('click', async () => {
    const cards = Array.from(resultGrid.querySelectorAll('.result-card'));
    if (!cards.length) return;
    if (typeof JSZip === 'undefined') { alert('JSZip 未加载，请检查网络'); return; }
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = '打包中...';
    const zip = new JSZip();
    cards.forEach((c) => zip.file(c._filename, c._blob));
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `batch-images-${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      log('打包失败: ' + e.message, 'fail');
    }
    downloadAllBtn.disabled = false;
    downloadAllBtn.textContent = '⬇ 打包下载全部';
  });

  // ---------- 初始化 ----------
  loadCfg();
  updateCount();
})();
