/**
 * @description scx-terminal 官网交互脚本 — 开机引导、活体终端打字机、滚动揭示、
 *              3D 倾斜卡片、聚光跟随、磁吸按钮、FPS 计数器、命令面板彩蛋
 */

(() => {
  "use strict";

  /** @description 请求动画帧的 requestAnimationFrame 简写 */
  const raf = requestAnimationFrame;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** @description 按页面语言选择文案（zh-CN / en）@param {{zh:string,en:string}} dict 双语字典 @returns {string} 当前语言文案 */
  const t = (dict) => (document.documentElement.lang.startsWith("zh") ? dict.zh : dict.en);

  /** @description 异步等待指定毫秒 @param {number} ms 毫秒 @returns {Promise<void>} */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ==================== 1. 开机引导层 ==================== */

  /** @description 逐行输出开机日志并推进进度条，完成后放行页面 @returns {Promise<void>} */
  async function runBoot() {
    const boot = document.getElementById("boot");
    const log = document.getElementById("bootLog");
    const bar = document.getElementById("bootBar");
    const lines = t({
      zh: [
        "scx-terminal bootloader v0.2.3",
        "[ ok ] probing shell ...................... zsh",
        "[ ok ] mounting pty driver (rust) ........ done",
        "[ ok ] initializing webgl renderer ....... 60fps",
        "[ ok ] loading session factory ........... local/ssh/mosh",
      ],
      en: [
        "scx-terminal bootloader v0.2.3",
        "[ ok ] probing shell ...................... zsh",
        "[ ok ] mounting pty driver (rust) ........ done",
        "[ ok ] initializing webgl renderer ....... 60fps",
        "[ ok ] loading session factory ........... local/ssh/mosh",
      ],
    });
    if (prefersReduced) { boot.classList.add("is-done"); return; }
    for (let i = 0; i < lines.length; i++) {
      log.innerHTML += (i === 0 ? "" : "\n") + lines[i];
      bar.style.width = `${((i + 1) / lines.length) * 100}%`;
      await wait(160);
    }
    await wait(280);
    boot.classList.add("is-done");
  }

  /* ==================== 2. Hero 活体终端打字机 ==================== */

  const termBody = document.getElementById("termBody");

  /** @description 终端剧本（随语言切换）：每条为 [html类名, 文本, 打字速度, 输出前停顿] @returns {Array} 剧本行 */
  const script = () => t({
    zh: [
      ["t-cmd", "scx --version", 38, 300],
      ["t-out", "scx-terminal 0.2.3 (tauri v2 · rust · vue3)", 0, 500],
      ["t-cmd", "ssh deploy@prod-01", 42, 400],
      ["t-ok",  "✓ connected · mosh fallback armed", 0, 420],
      ["t-out", "deploy@prod-01:~$ htop", 0, 300],
      ["t-out", "CPU [||||||||||    62%]   MEM [|||||       41%]", 14, 500],
      ["t-cmd", "sftp push ./dist/* /var/www/", 34, 400],
      ["t-ok",  "✓ 244 files · 1.8s · WebGL rendering active", 0, 600],
      ["t-warn", "提示：这只是网页 —— 真正的终端在「下载」里 ↓", 18, 0],
    ],
    en: [
      ["t-cmd", "scx --version", 38, 300],
      ["t-out", "scx-terminal 0.2.3 (tauri v2 · rust · vue3)", 0, 500],
      ["t-cmd", "ssh deploy@prod-01", 42, 400],
      ["t-ok",  "✓ connected · mosh fallback armed", 0, 420],
      ["t-out", "deploy@prod-01:~$ htop", 0, 300],
      ["t-out", "CPU [||||||||||    62%]   MEM [|||||       41%]", 14, 500],
      ["t-cmd", "sftp push ./dist/* /var/www/", 34, 400],
      ["t-ok",  "✓ 244 files · 1.8s · WebGL rendering active", 0, 600],
      ["t-warn", "Hint: this is just a web page — the real terminal lives in Download ↓", 14, 0],
    ],
  });

  /** @description 打字机：逐字符输出一段文本 @param {HTMLElement} el 目标元素 @param {string} text 文本 @param {number} speed 每字符毫秒 @returns {Promise<void>} */
  async function typeText(el, text, speed) {
    for (const ch of text) {
      el.textContent += ch;
      if (speed > 0) await wait(speed);
    }
  }

  /** @description 循环播放终端剧本（先清屏再重演）@returns {Promise<void>} */
  async function playTerm() {
    if (!termBody) return;
    for (;;) {
      termBody.innerHTML = "";
      for (const [cls, text, speed, pause] of script()) {
        const line = document.createElement("span");
        line.className = cls;
        termBody.appendChild(line);
        if (speed > 0) await typeText(line, text, speed);
        else line.textContent = text;
        termBody.appendChild(document.createTextNode("\n"));
        await wait(pause);
      }
      termBody.insertAdjacentHTML("beforeend", '<span class="caret"></span>');
      await wait(4200);
    }
  }

  /** @description Hero 终端 3D 视差：鼠标位置映射轻微旋转 @param {MouseEvent} e 鼠标事件 @returns {void} */
  function termParallax(e) {
    const term = document.getElementById("heroTerm");
    if (!term || prefersReduced) return;
    const r = term.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    term.style.transform = `perspective(900px) rotateY(${dx * 5}deg) rotateX(${-dy * 4}deg)`;
  }

  /* ==================== 3. 滚动揭示（IntersectionObserver） ==================== */

  /** @description 为 .reveal 元素挂载交错入场动画，并触发数字计数 @returns {void} */
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = [...(el.parentElement?.children || [])].indexOf(el) * 90;
        setTimeout(() => el.classList.add("is-visible"), delay);
        if (el.classList.contains("stat")) startCount(el.querySelector(".stat__num"));
        io.unobserve(el);
      });
    }, { threshold: 0.18 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  }

  /** @description 数字从 0 计数到目标值（rAF 缓动）@param {HTMLElement|null} el 数字元素 @returns {void} */
  function startCount(el) {
    if (!el) return;
    const target = Number(el.dataset.count || 0);
    if (prefersReduced) { el.textContent = String(target); return; }
    const t0 = performance.now();
    const dur = 1400;
    /** @description 单帧推进计数动画 @param {number} t 当前时间戳 @returns {void} */
    const tick = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf(tick);
    };
    raf(tick);
  }

  /* ==================== 4. 聚光跟随 & 磁吸按钮 & 卡片倾斜 ==================== */

  /** @description 页面级聚光灯与数据指针跟随 @returns {void} */
  function initSpotlight() {
    const spot = document.getElementById("spotlight");
    window.addEventListener("pointermove", (e) => {
      document.documentElement.style.setProperty("--mx", `${e.clientX}px`);
      document.documentElement.style.setProperty("--my", `${e.clientY}px`);
      termParallax(e);
      if (spot) spot.style.setProperty("--mx", `${e.clientX}px`);
    }, { passive: true });
  }

  /** @description 磁吸按钮：指针接近时按钮轻微吸附位移 @returns {void} */
  function initMagnetic() {
    document.querySelectorAll("[data-magnetic]").forEach((btn) => {
      btn.addEventListener("pointermove", (e) => {
        if (prefersReduced) return;
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.transform = ""; });
    });
  }

  /** @description bento 卡片 3D 倾斜 + 眩光定位 @returns {void} */
  function initTilt() {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        if (prefersReduced) return;
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.transform = `perspective(800px) rotateY(${(px - 0.5) * 7}deg) rotateX(${(0.5 - py) * 7}deg) translateY(-3px)`;
        card.style.setProperty("--gx", `${px * 100}%`);
        card.style.setProperty("--gy", `${py * 100}%`);
      });
      card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    });
  }

  /* ==================== 5. FPS 计数器（特性卡演示） ==================== */

  /** @description 用真实 rAF 帧率驱动特性卡里的 fps 数字 @returns {void} */
  function initFps() {
    const meter = document.getElementById("fpsMeter");
    if (!meter) return;
    let frames = 0; let last = performance.now();
    /** @description 每帧累计并在秒界刷新读数 @param {number} t 当前时间戳 @returns {void} */
    const loop = (t) => {
      frames++;
      if (t - last >= 1000) {
        meter.textContent = String(Math.min(frames, 60));
        frames = 0; last = t;
      }
      raf(loop);
    };
    raf(loop);
  }

  /* ==================== 6. 导航滚动态 ==================== */

  /** @description 导航入场与滚动边框切换 @returns {void} */
  function initNav() {
    const nav = document.getElementById("nav");
    setTimeout(() => nav.classList.add("is-in"), 300);
    window.addEventListener("scroll", () => {
      nav.classList.toggle("is-scrolled", window.scrollY > 24);
    }, { passive: true });
  }

  /* ==================== 7. 命令面板（⌘K 彩蛋） ==================== */

  /** @description 命令面板命令清单（随语言切换）@returns {Array<{label:string,hint:string,href:string}>} 命令项 */
  const commands = () => t({
    zh: [
      { label: "前往：特性", hint: "章节", href: "#features" },
      { label: "前往：架构", hint: "章节", href: "#architecture" },
      { label: "前往：下载", hint: "章节", href: "#download" },
      { label: "GitHub 仓库", hint: "外链", href: "https://github.com/shawicx/scx-terminal" },
      { label: "Releases 下载页", hint: "外链", href: "https://github.com/shawicx/scx-terminal/releases" },
      { label: "sudo make me a terminal", hint: "彩蛋", href: "#download" },
    ],
    en: [
      { label: "Go to: Features", hint: "section", href: "#features" },
      { label: "Go to: Architecture", hint: "section", href: "#architecture" },
      { label: "Go to: Download", hint: "section", href: "#download" },
      { label: "GitHub repository", hint: "external", href: "https://github.com/shawicx/scx-terminal" },
      { label: "Releases page", hint: "external", href: "https://github.com/shawicx/scx-terminal/releases" },
      { label: "sudo make me a terminal", hint: "fun", href: "#download" },
    ],
  });

  /** @description 初始化命令面板：快捷键、过滤、键盘导航与执行 @returns {void} */
  function initPalette() {
    const palette = document.getElementById("palette");
    const input = document.getElementById("paletteInput");
    const list = document.getElementById("paletteList");
    if (!palette || !input || !list) return;
    input.placeholder = t({ zh: "输入命令或搜索…", en: "Type a command or search…" });
    let active = 0; let items = [];

    /** @description 按关键词渲染过滤后的命令列表 @param {string} q 关键词 @returns {void} */
    function render(q) {
      items = commands().filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
      list.innerHTML = "";
      items.forEach((c, i) => {
        const li = document.createElement("li");
        li.className = "palette__item" + (i === active ? " is-active" : "");
        li.innerHTML = `<b>${c.label}</b><span class="palette__hint">${c.hint}</span>`;
        li.addEventListener("click", () => exec(c));
        list.appendChild(li);
      });
    }

    /** @description 执行命令：跳转或打开链接并关闭面板 @param {{label:string,href:string}} c 命令项 @returns {void} */
    function exec(c) {
      close();
      if (c.href.startsWith("#")) document.querySelector(c.href)?.scrollIntoView({ behavior: "smooth" });
      else window.open(c.href, "_blank", "noopener");
    }

    /** @description 打开面板 @returns {void} */
    function open() {
      palette.hidden = false;
      raf(() => palette.classList.add("is-open"));
      input.value = ""; active = 0; render("");
      input.focus();
    }

    /** @description 关闭面板 @returns {void} */
    function close() {
      palette.classList.remove("is-open");
      setTimeout(() => { palette.hidden = true; }, 200);
    }

    input.addEventListener("input", () => { active = 0; render(input.value); });
    palette.addEventListener("click", (e) => { if (e.target === palette) close(); });
    document.getElementById("paletteBtn")?.addEventListener("click", open);

    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette.hidden ? open() : close();
        return;
      }
      if (palette.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); render(input.value); }
      if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); render(input.value); }
      if (e.key === "Enter" && items[active]) exec(items[active]);
    });
  }

  /* ==================== 启动 ==================== */

  document.addEventListener("DOMContentLoaded", () => {
    runBoot();
    initNav();
    initReveal();
    initSpotlight();
    initMagnetic();
    initTilt();
    initFps();
    initPalette();
    playTerm();
  });
})();
